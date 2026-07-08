import { describe, it, expect, vi } from 'vitest';
import { fullSync, incrementalSync } from '../src/worker/sync';
import { mockKV } from './helpers';
import type { GitHub } from '../src/worker/github';

function mockGH(files: Record<string, string>): GitHub {
  return {
    listMarkdownPaths: vi.fn(async () => Object.keys(files)),
    getFile: vi.fn(async (p: string) =>
      files[p] != null ? { content: files[p], sha: 'sha-' + p } : null),
    putFile: vi.fn(),
  } as unknown as GitHub;
}

describe('fullSync', () => {
  it('抓白名單+wiki、跳過其他、建索引', async () => {
    const kv = mockKV();
    const gh = mockGH({
      '個人學習/a.md': '---\ntitle: A\n---\n內容A',
      'wiki/k.md': 'wiki 內容',
      '日常/d.md': '不索引',
    });
    const r = await fullSync(kv, gh);
    expect(r.synced).toBe(2);
    expect(await kv.get('note:個人學習/a.md', 'json')).toEqual({ content: '---\ntitle: A\n---\n內容A', sha: 'sha-個人學習/a.md' });
    expect(await kv.get('note:日常/d.md')).toBeNull();
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string }[] };
    expect(idx.notes.length).toBe(2);
  });
});

describe('incrementalSync', () => {
  it('added/modified 更新、removed 刪除、重建索引', async () => {
    const kv = mockKV({
      'note:個人學習/old.md': JSON.stringify({ content: '舊', sha: 's1' }),
      'note:個人學習/gone.md': JSON.stringify({ content: '將刪', sha: 's2' }),
    });
    const gh = mockGH({ '個人學習/new.md': '新檔', '個人學習/old.md': '改過' });
    const r = await incrementalSync(kv, gh, {
      commits: [
        { added: ['個人學習/new.md', '圖/x.png'], modified: ['個人學習/old.md'], removed: ['個人學習/gone.md'] },
      ],
    });
    expect(r).toEqual({ synced: 2, removed: 1 });
    expect(await kv.get('note:個人學習/gone.md')).toBeNull();
    expect(((await kv.get('note:個人學習/old.md', 'json')) as { content: string }).content).toBe('改過');
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string }[] };
    expect(idx.notes.map((n) => n.path).sort()).toEqual(['個人學習/new.md', '個人學習/old.md']);
  });
});
