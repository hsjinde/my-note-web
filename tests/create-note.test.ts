import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/worker/index';
import { mockKV } from './helpers';
import { createSession } from '../src/worker/auth';

afterEach(() => vi.unstubAllGlobals());

function env(kvInit: Record<string, string> = {}) {
  return {
    NOTES: mockKV(kvInit),
    SITE_PASSWORD: 'pw', SESSION_SECRET: 'ss', WEBHOOK_SECRET: 'ws',
    GITHUB_TOKEN: 'tok', GITHUB_REPO: 'hsjinde/my-note', GITHUB_BRANCH: 'main',
    AI_MODEL: 'test-model', AI: { run: async () => ({ response: 'ok' }) },
  } as never;
}
const authedHeaders = async () => ({ Cookie: `session=${await createSession('ss')}` });
const post = async (body: unknown, e = env()) =>
  app.request('/api/note', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(await authedHeaders()) },
  }, e);

// GitHub getFile(不存在 → 404) + putFile(建立 → 回 sha) 的 mock
function mockGithubCreate() {
  const captured: { message?: string; content?: string; path?: string } = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/contents/') && (!init || init.method === undefined)) {
      return new Response('not found', { status: 404 }); // getFile → 不存在
    }
    const b = JSON.parse(String(init?.body));
    captured.message = b.message; captured.content = b.content;
    captured.path = decodeURIComponent(u.split('/contents/')[1]);
    return Response.json({ content: { sha: 'new1' } });
  }));
  return captured;
}

describe('POST /api/note', () => {
  it('未登入 401', async () => {
    const res = await app.request('/api/note', {
      method: 'POST', body: JSON.stringify({ folder: '個人學習', title: '新筆記' }),
      headers: { 'Content-Type': 'application/json' },
    }, env());
    expect(res.status).toBe(401);
  });

  it('空白標題 400', async () => {
    const res = await post({ folder: '個人學習', title: '   ' });
    expect(res.status).toBe(400);
  });

  it('標題含非法字元 400', async () => {
    const res = await post({ folder: '個人學習', title: 'a/b' });
    expect(res.status).toBe(400);
  });

  it('非白名單資料夾 400', async () => {
    const res = await post({ folder: 'wiki', title: '祕密' });
    expect(res.status).toBe(400);
  });

  it('KV 已有同名筆記 → 409', async () => {
    const e = env({
      'shard:個人學習': JSON.stringify({ '個人學習/新筆記.md': { content: 'x', sha: 's' } }),
    });
    const res = await post({ folder: '個人學習', title: '新筆記' }, e);
    expect(res.status).toBe(409);
  });

  it('GitHub 已有同名筆記（KV 沒有）→ 409', async () => {
    // getFile 回 200（檔案存在），不應進到 putFile
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/contents/') && (!init || init.method === undefined)) {
        return Response.json({ content: btoa('existing'), sha: 'exist' });
      }
      throw new Error('should not putFile when file exists');
    }));
    const res = await post({ folder: '個人學習', title: '新筆記' });
    expect(res.status).toBe(409);
  });

  it('成功建立：commit 到 GitHub、寫入 KV、索引含新筆記，回傳 path 與 sha', async () => {
    const captured = mockGithubCreate();
    const e = env();
    const res = await post({ folder: '個人學習', title: '新筆記' }, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: '個人學習/新筆記.md', sha: 'new1' });
    expect(captured.message).toBe('docs: 新增「新筆記」');
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(captured.content!.replace(/\n/g, '')), (ch) => ch.charCodeAt(0)));
    expect(decoded).toBe('---\ntitle: 新筆記\n---\n\n');
    const kv = (e as { NOTES: { get: (k: string, t: string) => Promise<unknown> } }).NOTES;
    expect(await kv.get('shard:個人學習', 'json')).toEqual({
      '個人學習/新筆記.md': { content: '---\ntitle: 新筆記\n---\n\n', sha: 'new1' },
    });
    const idx = await kv.get('meta:index', 'json') as { notes: { path: string }[] };
    expect(idx.notes.some((n) => n.path === '個人學習/新筆記.md')).toBe(true);
  });
});
