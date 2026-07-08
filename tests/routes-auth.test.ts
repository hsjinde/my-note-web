import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/worker/index';
import { mockKV } from './helpers';
import { createSession } from '../src/worker/auth';
import { buildIndex } from '../src/worker/content';

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

describe('login/logout/me', () => {
  it('正確密碼發 cookie', async () => {
    const res = await app.request('/api/login', {
      method: 'POST', body: JSON.stringify({ password: 'pw' }),
      headers: { 'Content-Type': 'application/json' },
    }, env());
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!;
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=2592000');
  });
  it('錯誤密碼 401', async () => {
    const res = await app.request('/api/login', {
      method: 'POST', body: JSON.stringify({ password: 'no' }),
      headers: { 'Content-Type': 'application/json' },
    }, env());
    expect(res.status).toBe(401);
  });
  it('me 反映登入狀態', async () => {
    const anon = await app.request('/api/me', {}, env());
    expect(await anon.json()).toEqual({ authed: false });
    const authed = await app.request('/api/me', { headers: await authedHeaders() }, env());
    expect(await authed.json()).toEqual({ authed: true });
  });
});

describe('PUT /api/note/*', () => {
  const kvInit = {
    'note:個人學習/a.md': JSON.stringify({ content: '---\ntitle: 筆記A\n---\n舊', sha: 'old' }),
    'meta:index': JSON.stringify(buildIndex([{ path: '個人學習/a.md', content: '---\ntitle: 筆記A\n---\n舊' }])),
  };
  it('未登入 401', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {
      method: 'PUT', body: JSON.stringify({ content: 'x', sha: 'old' }),
      headers: { 'Content-Type': 'application/json' },
    }, env(kvInit));
    expect(res.status).toBe(401);
  });
  it('登入後 commit 到 GitHub 並更新 KV', async () => {
    let captured: { message?: string } = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return Response.json({ content: { sha: 'new1' } });
    }));
    const e = env(kvInit);
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {
      method: 'PUT',
      body: JSON.stringify({ content: '---\ntitle: 筆記A\n---\n新內容', sha: 'old' }),
      headers: { 'Content-Type': 'application/json', ...(await authedHeaders()) },
    }, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha: 'new1' });
    expect(captured.message).toBe('docs: 網頁編輯「筆記A」');
    const kv = (e as { NOTES: { get: (k: string, t: string) => Promise<unknown> } }).NOTES;
    expect(await kv.get('note:個人學習/a.md', 'json')).toEqual({ content: '---\ntitle: 筆記A\n---\n新內容', sha: 'new1' });
  });
  it('sha 衝突回 409', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('conflict', { status: 409 })));
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {
      method: 'PUT', body: JSON.stringify({ content: 'x', sha: 'stale' }),
      headers: { 'Content-Type': 'application/json', ...(await authedHeaders()) },
    }, env(kvInit));
    expect(res.status).toBe(409);
  });
});

describe('POST /api/webhook', () => {
  async function sign(body: string) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('ws'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  it('壞簽章 401', async () => {
    const res = await app.request('/api/webhook', {
      method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=00' },
    }, env());
    expect(res.status).toBe(401);
  });
  it('好簽章觸發增量同步', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      content: btoa(String.fromCharCode(...new TextEncoder().encode('新'))), sha: 's9', encoding: 'base64',
    })));
    const body = JSON.stringify({ commits: [{ added: ['個人學習/n.md'], modified: [], removed: [] }] });
    const res = await app.request('/api/webhook', {
      method: 'POST', body, headers: { 'X-Hub-Signature-256': await sign(body) },
    }, env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 1, removed: 0 });
  });
});
