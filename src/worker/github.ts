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

  async listMarkdownEntries(): Promise<{ path: string; sha: string }[]> {
    const res = await this.req(`/git/trees/${this.branch}?recursive=1`);
    if (!res.ok) throw new Error(`getTree failed: ${res.status}`);
    const data = (await res.json()) as { tree: { path: string; type: string; sha: string }[]; truncated?: boolean };
    // tree 被截斷代表這不是完整清單；對帳同步會把「清單裡沒有」當成已刪除，
    // 拿截斷的清單去比對會誤刪整批筆記，所以寧可失敗也不回傳半套資料。
    if (data.truncated) throw new Error('getTree truncated: repo tree too large for a single response');
    return data.tree
      .filter((t) => t.type === 'blob' && t.path.endsWith('.md'))
      .map((t) => ({ path: t.path, sha: t.sha }));
  }

  // 回填「最近編輯」用：tree 與 contents API 都不帶時間，只有 commits API 有。
  async getLastCommitDate(path: string): Promise<string | null> {
    const res = await this.req(
      `/commits?sha=${this.branch}&path=${encodeURIComponent(path)}&per_page=1`);
    if (!res.ok) throw new Error(`getLastCommitDate ${path} failed: ${res.status}`);
    const data = (await res.json()) as { commit?: { committer?: { date?: string } } }[];
    return data[0]?.commit?.committer?.date ?? null;
  }

  async getTarballBuffer(): Promise<ArrayBuffer> {
    const res = await this.req(`/tarball/${this.branch}`);
    if (!res.ok) throw new Error(`getTarball failed: ${res.status}`);
    return res.arrayBuffer();
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
