export class ShaConflictError extends Error {}

const b64encodeUtf8 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64decodeUtf8 = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

export class GitHub {
  constructor(private token: string, private repo: string, private branch: string) {}

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'my-note-web',
        ...(init.headers ?? {}),
      },
    });
  }

  async listMarkdownPaths(): Promise<string[]> {
    const res = await this.req(`/git/trees/${this.branch}?recursive=1`);
    if (!res.ok) throw new Error(`getTree failed: ${res.status}`);
    const data = (await res.json()) as { tree: { path: string; type: string }[] };
    return data.tree.filter((t) => t.type === 'blob' && t.path.endsWith('.md')).map((t) => t.path);
  }

  async getFile(path: string): Promise<{ content: string; sha: string } | null> {
    const res = await this.req(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${this.branch}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`getFile ${path} failed: ${res.status}`);
    const data = (await res.json()) as { content: string; sha: string };
    return { content: b64decodeUtf8(data.content), sha: data.sha };
  }

  async putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string }> {
    const res = await this.req(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      body: JSON.stringify({ message, branch: this.branch, content: b64encodeUtf8(content), ...(sha ? { sha } : {}) }),
    });
    if (res.status === 409 || res.status === 422) throw new ShaConflictError(`sha conflict for ${path}`);
    if (!res.ok) throw new Error(`putFile ${path} failed: ${res.status}`);
    const data = (await res.json()) as { content: { sha: string } };
    return { sha: data.content.sha };
  }
}
