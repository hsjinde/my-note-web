import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitHub, ShaConflictError } from '../src/worker/github';

const gh = () => new GitHub('tok', 'hsjinde/my-note', 'main');
afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => handler(String(url), init)));
}

describe('GitHub client', () => {
  it('listMarkdownPaths 過濾出 .md blob', async () => {
    stubFetch((url) => {
      expect(url).toBe('https://api.github.com/repos/hsjinde/my-note/git/trees/main?recursive=1');
      return Response.json({ tree: [
        { path: '個人學習/a.md', type: 'blob' },
        { path: '個人學習', type: 'tree' },
        { path: 'img/x.png', type: 'blob' },
      ]});
    });
    expect(await gh().listMarkdownPaths()).toEqual(['個人學習/a.md']);
  });

  it('getFile 解 base64（UTF-8 中文）並回 sha', async () => {
    const content = '# 中文內容';
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(content)));
    stubFetch((url) => {
      expect(decodeURIComponent(url)).toContain('/contents/個人學習/a.md?ref=main');
      return Response.json({ content: b64, sha: 'abc123', encoding: 'base64' });
    });
    expect(await gh().getFile('個人學習/a.md')).toEqual({ content, sha: 'abc123' });
  });

  it('getFile 404 回 null', async () => {
    stubFetch(() => new Response('nf', { status: 404 }));
    expect(await gh().getFile('x.md')).toBeNull();
  });

  it('putFile 帶 message/branch/sha 且回新 sha', async () => {
    stubFetch(async (url, init) => {
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init?.body));
      expect(body.message).toBe('docs: 網頁編輯「筆記A」');
      expect(body.branch).toBe('main');
      expect(body.sha).toBe('old');
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)));
      expect(decoded).toBe('新內容');
      return Response.json({ content: { sha: 'new456' } }, { status: 200 });
    });
    expect(await gh().putFile('個人學習/a.md', '新內容', 'docs: 網頁編輯「筆記A」', 'old')).toEqual({ sha: 'new456' });
  });

  it('putFile sha 衝突丟 ShaConflictError', async () => {
    stubFetch(() => new Response('conflict', { status: 409 }));
    await expect(gh().putFile('a.md', 'x', 'm', 'old')).rejects.toBeInstanceOf(ShaConflictError);
  });
});
