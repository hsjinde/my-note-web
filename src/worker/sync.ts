import type { GitHub } from './github';
import { buildIndex, isIndexedPath } from './content';

export type PushPayload = {
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
};

async function listNoteKeys(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await kv.list({ prefix: 'note:', cursor });
    keys.push(...res.keys.map((k) => k.name));
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

export async function rebuildIndexFromKV(kv: KVNamespace): Promise<void> {
  const keys = await listNoteKeys(kv);
  const files: { path: string; content: string }[] = [];
  for (const key of keys) {
    const v = (await kv.get(key, 'json')) as { content: string } | null;
    if (v) files.push({ path: key.slice('note:'.length), content: v.content });
  }
  await kv.put('meta:index', JSON.stringify(buildIndex(files)));
}

export async function fullSync(kv: KVNamespace, gh: GitHub): Promise<{ synced: number }> {
  const paths = (await gh.listMarkdownPaths()).filter(isIndexedPath);
  let synced = 0;
  for (const path of paths) {
    const file = await gh.getFile(path);
    if (!file) continue;
    await kv.put(`note:${path}`, JSON.stringify(file));
    synced++;
  }
  // 移除 repo 已不存在的舊 note
  const current = new Set(paths.map((p) => `note:${p}`));
  for (const key of await listNoteKeys(kv)) {
    if (!current.has(key)) await kv.delete(key);
  }
  await rebuildIndexFromKV(kv);
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
  let synced = 0;
  for (const path of changed) {
    const file = await gh.getFile(path);
    if (!file) { removedSet.add(path); continue; }
    await kv.put(`note:${path}`, JSON.stringify(file));
    synced++;
  }
  for (const path of removedSet) await kv.delete(`note:${path}`);
  if (synced || removedSet.size) await rebuildIndexFromKV(kv);
  return { synced, removed: removedSet.size };
}
