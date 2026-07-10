import { parse as parseYaml } from 'yaml';
import type { NoteMeta, SiteIndex } from '../shared/types';
import { PUBLIC_FOLDERS } from '../shared/folders';

export { PUBLIC_FOLDERS };
export const AI_EXTRA_FOLDERS = ['wiki'];

const inFolders = (path: string, folders: string[]) =>
  folders.some((f) => path.startsWith(f + '/'));

export function isPublicPath(path: string): boolean {
  return path.endsWith('.md') && inFolders(path, PUBLIC_FOLDERS);
}
export function isIndexedPath(path: string): boolean {
  return path.endsWith('.md') && inFolders(path, [...PUBLIC_FOLDERS, ...AI_EXTRA_FOLDERS]);
}

export function splitFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: md };
  let fm: Record<string, unknown> = {};
  try { fm = (parseYaml(m[1]) as Record<string, unknown>) ?? {}; } catch { fm = {}; }
  return { fm, body: md.slice(m[0].length) };
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

export function parseNote(path: string, md: string): NoteMeta {
  const { fm, body } = splitFrontmatter(md);
  const filename = path.split('/').pop()!.replace(/\.md$/, '');
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
  const rawDate = fm.date ?? fm.updated ?? null;
  const links = [...body.matchAll(WIKILINK)].map((m) => m[1].trim());
  const plain = body
    .replace(WIKILINK, (_, t) => t)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_\[\]!|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    path,
    title: typeof fm.title === 'string' && fm.title ? fm.title : filename,
    folder: path.split('/').slice(0, -1).join('/'),
    tags,
    date: rawDate ? String(rawDate).slice(0, 10) : null,
    excerpt: plain.slice(0, 160),
    links,
    linksTo: [],
    private: !isPublicPath(path),
  };
}

export function buildIndex(files: { path: string; content: string }[]): SiteIndex {
  const notes = files.filter((f) => isIndexedPath(f.path)).map((f) => parseNote(f.path, f.content));
  const byKey = new Map<string, string>(); // 檔名/title（小寫）→ path
  for (const n of notes) {
    byKey.set(n.path.split('/').pop()!.replace(/\.md$/, '').toLowerCase(), n.path);
    byKey.set(n.title.toLowerCase(), n.path);
  }
  for (const n of notes) {
    n.linksTo = n.links
      .map((t) => byKey.get(t.toLowerCase()))
      .filter((p): p is string => !!p && p !== n.path);
  }
  return { notes, builtAt: new Date().toISOString() };
}

export function publicIndex(index: SiteIndex): SiteIndex {
  const pubPaths = new Set(index.notes.filter((n) => !n.private).map((n) => n.path));
  return {
    builtAt: index.builtAt,
    notes: index.notes
      .filter((n) => !n.private)
      .map((n) => ({ ...n, linksTo: n.linksTo.filter((p) => pubPaths.has(p)) })),
  };
}
