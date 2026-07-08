import { describe, it, expect } from 'vitest';
import app from '../src/worker/index';
import { mockKV } from './helpers';
import { buildIndex } from '../src/worker/content';

function env(kvInit: Record<string, string> = {}) {
  return {
    NOTES: mockKV(kvInit),
    SITE_PASSWORD: 'pw', SESSION_SECRET: 'ss', WEBHOOK_SECRET: 'ws',
    GITHUB_TOKEN: 'tok', GITHUB_REPO: 'hsjinde/my-note', GITHUB_BRANCH: 'main',
    AI_MODEL: 'test-model', AI: { run: async () => ({ response: 'ok' }) },
  } as never;
}

const idx = buildIndex([
  { path: '個人學習/a.md', content: '---\ntitle: A\n---\n內容' },
  { path: 'wiki/k.md', content: '秘密' },
]);

describe('GET /api/index', () => {
  it('回公開索引（不含 wiki）', async () => {
    const res = await app.request('/api/index', {}, env({ 'meta:index': JSON.stringify(idx) }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { notes: { path: string }[] };
    expect(data.notes.map((n) => n.path)).toEqual(['個人學習/a.md']);
  });
  it('無索引回空', async () => {
    const res = await app.request('/api/index', {}, env());
    expect(((await res.json()) as { notes: unknown[] }).notes).toEqual([]);
  });
});

describe('GET /api/note/*', () => {
  const kv = {
    'note:個人學習/a.md': JSON.stringify({ content: '# A', sha: 's1' }),
    'note:wiki/k.md': JSON.stringify({ content: '秘密', sha: 's2' }),
  };
  it('公開筆記回內容與 sha', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {}, env(kv));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: '個人學習/a.md', content: '# A', sha: 's1' });
  });
  it('wiki 路徑回 404', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('wiki/k.md')}`, {}, env(kv));
    expect(res.status).toBe(404);
  });
  it('不存在回 404', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/none.md')}`, {}, env(kv));
    expect(res.status).toBe(404);
  });
});
