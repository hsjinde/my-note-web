import type { GitHub } from './github';
import { buildIndex, isIndexedPath } from './content';
import { parseTarGz } from './tarball';

type Shard = Record<string, { content: string; sha: string }>;

export function shardKey(path: string): string {
  return `shard:${path.split('/')[0]}`;
}

async function getShard(kv: KVNamespace, key: string): Promise<Shard> {
  return ((await kv.get(key, 'json')) as Shard | null) ?? {};
}

async function readAllShards(kv: KVNamespace): Promise<{ path: string; content: string }[]> {
  const listed = await kv.list({ prefix: 'shard:' });
  const files: { path: string; content: string }[] = [];
  for (const k of listed.keys) {
    const shard = await getShard(kv, k.name);
    for (const [path, note] of Object.entries(shard)) files.push({ path, content: note.content });
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
    shards.get(key)![path] = { content: entry.content, sha };
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
    Object.entries(shard).map(([path, note]) => ({ path, content: note.content })));
  await kv.put('meta:index', JSON.stringify(buildIndex(files)));

  return { synced };
}

// 一次對帳最多抓幾個檔案。Workers 對單一 request 的 subrequest 數量有上限，
// 累積大量漏同步時一次抓完會超限，所以分批補，剩下的留給下一次 push。
export const MAX_FETCH_PER_RECONCILE = 40;

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

  const batch = stale.slice(0, MAX_FETCH_PER_RECONCILE);
  let synced = 0;
  for (const path of batch) {
    const file = await gh.getFile(path);
    if (!file) continue; // tree 與 contents 短暫不同步，下次對帳再處理
    const key = shardKey(path);
    (await loadShard(key))[path] = file;
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
