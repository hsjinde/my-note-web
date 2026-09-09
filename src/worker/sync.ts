import type { GitHub } from './github';
import { buildIndex, isIndexedPath } from './content';
import { parseTarGz } from './tarball';

export type Shard = Record<string, { content: string; sha: string; updatedAt?: string }>;

export function shardKey(path: string): string {
  return `shard:${path.split('/')[0]}`;
}

async function getShard(kv: KVNamespace, key: string): Promise<Shard> {
  return ((await kv.get(key, 'json')) as Shard | null) ?? {};
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
    (await loadShard(key))[path] = { ...file, updatedAt: now };
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

// 一次性回填：舊筆記的 updatedAt 是空的（KV 以前沒記這個欄位），
// tree 與 contents API 都不帶時間，只能逐檔問 commits API，所以同樣分批做。
export async function backfillUpdatedAt(
  kv: KVNamespace, gh: GitHub,
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

  const batch = missing.slice(0, MAX_FETCH_PER_SYNC);
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
