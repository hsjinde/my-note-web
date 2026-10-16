import type { GitHub } from './github';
import { buildIndex, isIndexedPath } from './content';
import { parseTarGz } from './tarball';

export type StoredNote = { content: string; sha: string; updatedAt?: string };
export type Shard = Record<string, StoredNote>;

export function shardKey(path: string): string {
  return `shard:${path.split('/')[0]}`;
}

// 每篇筆記自己一個 key。shard 是「一個頂層資料夾一包全文」，讀一篇就得把整包
// JSON.parse 一次；個人學習那包大到會撞上 Workers 的資源上限（1102），線上有
// 一半的筆記讀不出來。讀取路徑改走這個小 key，shard 留給同步與索引重建用。
export function noteKey(path: string): string {
  return `note:${path}`;
}

async function getShard(kv: KVNamespace, key: string): Promise<Shard> {
  return ((await kv.get(key, 'json')) as Shard | null) ?? {};
}

/**
 * 讀一篇筆記。先拿小的 note: key，沒有才回頭 parse 舊的大 shard——還沒搬完的
 * 筆記照樣讀得到。`fromShard` 讓呼叫端知道可以順手把 note: key 補寫回去。
 */
export async function readNote(
  kv: KVNamespace, path: string,
): Promise<{ note: StoredNote | null; fromShard: boolean }> {
  const direct = (await kv.get(noteKey(path), 'json')) as StoredNote | null;
  if (direct) return { note: direct, fromShard: false };
  const note = (await getShard(kv, shardKey(path)))[path] ?? null;
  return { note, fromShard: note !== null };
}

export async function writeNote(kv: KVNamespace, path: string, note: StoredNote): Promise<void> {
  await kv.put(noteKey(path), JSON.stringify(note));
}

async function readAllShards(
  kv: KVNamespace,
): Promise<{ path: string; content: string; updatedAt?: string }[]> {
  const listed = await kv.list({ prefix: 'shard:' });
  const files: { path: string; content: string; updatedAt?: string }[] = [];
  for (const k of listed.keys) {
    const shard = await getShard(kv, k.name);
    for (const [path, note] of Object.entries(shard)) {
      files.push({ path, content: note.content, updatedAt: note.updatedAt });
    }
  }
  return files;
}

export async function rebuildIndexFromKV(kv: KVNamespace): Promise<void> {
  const files = await readAllShards(kv);
  await kv.put('meta:index', JSON.stringify(buildIndex(files)));
}

export async function fullSync(kv: KVNamespace, gh: GitHub): Promise<{ synced: number }> {
  const [entries, tarballBuf] = await Promise.all([gh.listMarkdownEntries(), gh.getTarballBuffer()]);
  const shaByPath = new Map(entries.map((e) => [e.path, e.sha]));
  const tarEntries = await parseTarGz(tarballBuf);

  // 整批重寫會蓋掉整個 shard，先記住既有的變更時間，sha 沒變的沿用，
  // 否則每跑一次 fullSync 就會把所有筆記的「最近編輯」重設成今天。
  const prev = new Map<string, { sha: string; updatedAt?: string }>();
  const existingShards = await kv.list({ prefix: 'shard:' });
  for (const k of existingShards.keys) {
    for (const [path, note] of Object.entries(await getShard(kv, k.name))) prev.set(path, note);
  }

  const now = new Date().toISOString();
  const shards = new Map<string, Shard>();
  let synced = 0;
  for (const entry of tarEntries) {
    const slash = entry.path.indexOf('/');
    if (slash < 0) continue; // top-level entry in the archive, not inside the vault
    const path = entry.path.slice(slash + 1); // strip the "<repo>-<ref>/" prefix GitHub adds
    if (!isIndexedPath(path)) continue;
    const sha = shaByPath.get(path);
    if (!sha) continue; // tree/tarball mismatch guard
    const key = shardKey(path);
    if (!shards.has(key)) shards.set(key, {});
    const before = prev.get(path);
    shards.get(key)![path] = {
      content: entry.content, sha,
      updatedAt: before && before.sha === sha ? before.updatedAt : now,
    };
    synced++;
  }

  const existing = await kv.list({ prefix: 'shard:' });
  const newKeys = new Set(shards.keys());
  for (const k of existing.keys) {
    if (!newKeys.has(k.name)) await kv.delete(k.name);
  }
  for (const [key, shard] of shards) {
    await kv.put(key, JSON.stringify(shard));
  }

  // 整批重寫時 note: key 也要跟著換掉，否則讀取路徑會永遠餵出舊內容；
  // 已經不在 vault 裡的筆記連 key 一起刪。
  const wantedNotes = new Set<string>();
  for (const shard of shards.values()) {
    for (const [path, note] of Object.entries(shard)) {
      wantedNotes.add(noteKey(path));
      await writeNote(kv, path, note);
    }
  }
  const existingNotes = await kv.list({ prefix: 'note:' });
  for (const k of existingNotes.keys) {
    if (!wantedNotes.has(k.name)) await kv.delete(k.name);
  }
  await kv.put(MIGRATION_KEY, JSON.stringify({ offset: 0, migrated: wantedNotes.size, done: true }));

  const files = [...shards.values()].flatMap((shard) =>
    Object.entries(shard).map(([path, note]) => ({ path, content: note.content, updatedAt: note.updatedAt })));
  await kv.put('meta:index', JSON.stringify(buildIndex(files)));

  return { synced };
}

// 單次同步最多對 GitHub 抓幾個檔案（對帳與回填共用）。Workers 對單一 request 的
// subrequest 數量有上限，累積大量待補時一次抓完會超限，所以分批，剩下的留給下一次。
export const MAX_FETCH_PER_SYNC = 40;

// 以 GitHub tree 的完整 sha 清單為準對帳，不看 push payload。
// webhook 只要漏送一次，信任 payload 的增量同步就會永久漏掉那些檔案；
// 改成對帳後，任何漏掉的變動都會在下一次 push 自動補回來。
export async function reconcileSync(
  kv: KVNamespace, gh: GitHub,
): Promise<{ synced: number; removed: number; pending: number }> {
  const entries = (await gh.listMarkdownEntries()).filter((e) => isIndexedPath(e.path));
  const wanted = new Map(entries.map((e) => [e.path, e.sha]));

  const shards = new Map<string, Shard>();
  const dirty = new Set<string>();
  const loadShard = async (key: string): Promise<Shard> => {
    if (!shards.has(key)) shards.set(key, await getShard(kv, key));
    return shards.get(key)!;
  };
  // 先載入現有的全部 shard，才有辦法判斷哪些筆記已經從 GitHub 消失。
  const listed = await kv.list({ prefix: 'shard:' });
  for (const k of listed.keys) await loadShard(k.name);

  const stale: string[] = [];
  for (const [path, sha] of wanted) {
    const shard = await loadShard(shardKey(path));
    if (shard[path]?.sha !== sha) stale.push(path);
  }

  let removed = 0;
  for (const [key, shard] of shards) {
    for (const path of Object.keys(shard)) {
      if (wanted.has(path)) continue;
      delete shard[path];
      await kv.delete(noteKey(path));
      dirty.add(key);
      removed++;
    }
  }

  const batch = stale.slice(0, MAX_FETCH_PER_SYNC);
  const now = new Date().toISOString();
  let synced = 0;
  for (const path of batch) {
    const file = await gh.getFile(path);
    if (!file) continue; // tree 與 contents 短暫不同步，下次對帳再處理
    const key = shardKey(path);
    const note = { ...file, updatedAt: now };
    (await loadShard(key))[path] = note;
    // 讀取路徑走 note: key，這裡不一起更新的話，改過的筆記會一直餵出舊內容。
    await writeNote(kv, path, note);
    dirty.add(key);
    synced++;
  }

  if (dirty.size) {
    for (const key of dirty) {
      const shard = shards.get(key)!;
      if (Object.keys(shard).length) await kv.put(key, JSON.stringify(shard));
      else await kv.delete(key);
    }
    await rebuildIndexFromKV(kv);
  }
  return { synced, removed, pending: stale.length - batch.length };
}

// 一次性搬遷：把舊 shard 裡的筆記拆成一篇一個 note: key。每次只 parse 一個
// shard、只寫 limit 篇，進度記在 KV，排程與 /api/migrate-notes 重複呼叫就會補完。
// 搬完之前讀取端仍會 fallback 回 shard，所以中途不會有筆記讀不到。
export const MIGRATION_KEY = 'meta:note-keys';
type MigrationState = { shard?: string; offset: number; migrated: number; done: boolean };

export async function migrateShardsToNotes(
  kv: KVNamespace, limit = MAX_FETCH_PER_SYNC,
): Promise<{ migrated: number; shard: string | null; done: boolean }> {
  const state = ((await kv.get(MIGRATION_KEY, 'json')) as MigrationState | null)
    ?? { offset: 0, migrated: 0, done: false };
  if (state.done || limit <= 0) return { migrated: 0, shard: state.shard ?? null, done: state.done };

  const listed = await kv.list({ prefix: 'shard:' });
  const names = listed.keys.map((k) => k.name).sort();
  if (!names.length) {
    await kv.put(MIGRATION_KEY, JSON.stringify({ ...state, done: true }));
    return { migrated: 0, shard: null, done: true };
  }

  let name = state.shard && names.includes(state.shard) ? state.shard : names[0];
  let offset = state.shard === name ? state.offset : 0;

  const entries = Object.entries(await getShard(kv, name));
  const batch = entries.slice(offset, offset + limit);
  for (const [path, note] of batch) await writeNote(kv, path, note);
  offset += batch.length;

  let done = false;
  if (offset >= entries.length) {
    const next = names[names.indexOf(name) + 1];
    if (next) { name = next; offset = 0; } else { done = true; }
  }
  const migrated = state.migrated + batch.length;
  await kv.put(MIGRATION_KEY, JSON.stringify({ shard: name, offset, migrated, done }));
  return { migrated: batch.length, shard: name, done };
}

// 一次性回填：舊筆記的 updatedAt 是空的（KV 以前沒記這個欄位），
// tree 與 contents API 都不帶時間，只能逐檔問 commits API，所以同樣分批做。
export async function backfillUpdatedAt(
  kv: KVNamespace, gh: GitHub, limit = MAX_FETCH_PER_SYNC,
): Promise<{ filled: number; pending: number }> {
  const listed = await kv.list({ prefix: 'shard:' });
  const shards = new Map<string, Shard>();
  for (const k of listed.keys) shards.set(k.name, await getShard(kv, k.name));

  const missing: { key: string; path: string }[] = [];
  for (const [key, shard] of shards) {
    for (const [path, note] of Object.entries(shard)) {
      if (!note.updatedAt) missing.push({ key, path });
    }
  }

  const batch = missing.slice(0, Math.max(0, limit));
  const dirty = new Set<string>();
  let filled = 0;
  for (const { key, path } of batch) {
    const date = await gh.getLastCommitDate(path);
    if (!date) continue; // 剛被刪掉之類的邊界情況，下次對帳會處理掉這筆
    shards.get(key)![path].updatedAt = date;
    dirty.add(key);
    filled++;
  }

  if (dirty.size) {
    for (const key of dirty) await kv.put(key, JSON.stringify(shards.get(key)!));
    await rebuildIndexFromKV(kv);
  }
  return { filled, pending: missing.length - batch.length };
}
