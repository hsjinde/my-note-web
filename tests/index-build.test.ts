import { describe, it, expect } from 'vitest';
import { buildIndex, publicIndex } from '../src/worker/content';

const files = [
  { path: '好工具推薦/a.md', content: '---\ntitle: 筆記A\n---\n連到 [[筆記B]] 和 [[wiki-k]] 和 [[不存在]]' },
  { path: '好工具推薦/b.md', content: '---\ntitle: 筆記B\n---\n內容' },
  { path: 'wiki/wiki-k.md', content: 'wiki 內容' },
];

describe('buildIndex', () => {
  const idx = buildIndex(files);
  it('包含全部索引筆記', () => expect(idx.notes.length).toBe(3));
  it('wikilink 解析成 path（含指向 wiki）', () => {
    const a = idx.notes.find((n) => n.path === '好工具推薦/a.md')!;
    expect(a.linksTo).toEqual(['好工具推薦/b.md', 'wiki/wiki-k.md']);
  });
  it('builtAt 是 ISO 字串', () => expect(idx.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/));
});

describe('publicIndex', () => {
  it('過濾 private 筆記且 linksTo 不含 wiki path', () => {
    const pub = publicIndex(buildIndex(files));
    expect(pub.notes.map((n) => n.path)).toEqual(['好工具推薦/a.md', '好工具推薦/b.md']);
    const a = pub.notes.find((n) => n.path === '好工具推薦/a.md')!;
    expect(a.linksTo).toEqual(['好工具推薦/b.md']);
  });
});
