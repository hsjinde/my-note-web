import type { GitHub } from './github';
import { buildIndex, isIndexedPath } from './content';
import { parseTarGz } from './tarball';

export type PushPayload = {
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
};

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

export async function incrementalSync(
  kv: KVNamespace, gh: GitHub, payload: PushPayload,
): Promise<{ synced: number; removed: number }> {
  const changed = new Set<string>();
  const removedSet = new Set<string>();
  for (const c of payload.commits ?? []) {
    for (const p of [...(c.added ?? []), ...(c.modified ?? [])]) if (isIndexedPath(p)) { changed.add(p); removedSet.delete(p); }
    for (const p of c.removed ?? []) if (isIndexedPath(p)) { removedSet.add(p); changed.delete(p); }
  }
  if (!changed.size && !removedSet.size) return { synced: 0, removed: 0 };

  const affectedKeys = new Set([...changed, ...removedSet].map(shardKey));
  const shardCache = new Map<string, Shard>();
  for (const key of affectedKeys) shardCache.set(key, await getShard(kv, key));

  let synced = 0;
  for (const path of changed) {
    const file = await gh.getFile(path);
    if (!file) { removedSet.add(path); continue; }
    shardCache.get(shardKey(path))![path] = file;
    synced++;
  }
  let removed = 0;
  for (const path of removedSet) {
    const shard = shardCache.get(shardKey(path))!;
    if (path in shard) { delete shard[path]; removed++; }
  }

  for (const [key, shard] of shardCache) await kv.put(key, JSON.stringify(shard));
  if (synced || removed) await rebuildIndexFromKV(kv);
  return { synced, removed };
}
