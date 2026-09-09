import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/worker/index';
import { mockKV } from './helpers';

afterEach(() => vi.unstubAllGlobals());

function env(kvInit: Record<string, string> = {}) {
  return {
    NOTES: mockKV(kvInit),
    SITE_PASSWORD: 'pw', SESSION_SECRET: 'ss', WEBHOOK_SECRET: 'ws',
    GITHUB_TOKEN: 'tok', GITHUB_REPO: 'hsjinde/my-note', GITHUB_BRANCH: 'main',
    AI_MODEL: 'test-model', AI: { run: async () => ({ response: 'ok' }) },
  } as never;
}

// tree 上 5 筆，其中 n0 的 sha 與 KV 不同（對帳要重抓），其餘 4 筆內容一致但缺 updatedAt（回填要補）
function stubGitHub(counters: { commits: number }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/git/trees/')) {
      return Response.json({ tree: Array.from({ length: 5 }, (_, i) => ({
        path: `個人學習/n${i}.md`, type: 'blob', sha: i === 0 ? 'sha-new' : `sha-${i}`,
      }))});
    }
    if (u.includes('/commits?')) {
      counters.commits++;
      return Response.json([{ commit: { committer: { date: '2026-09-02T08:59:47Z' } } }]);
    }
    return Response.json({ content: btoa('note'), sha: 'sha-new', encoding: 'base64' });
  }));
}

describe('scheduled（Cron Trigger）', () => {
  const kvInit = {
    'shard:個人學習': JSON.stringify(Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`個人學習/n${i}.md`, { content: `舊${i}`, sha: `sha-${i}` }]),
    )),
  };

  it('先對帳補內容，再用剩下的抓取預算補日期', async () => {
    const counters = { commits: 0 };
    stubGitHub(counters);
    const e = env(kvInit);
    await worker.scheduled({} as never, e, {} as never);

    const kv = (e as unknown as { NOTES: { get: (k: string, t: string) => Promise<unknown> } }).NOTES;
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { content: string; updatedAt?: string }>;

    // 對帳把 sha 變了的那筆重抓下來
    expect(shard['個人學習/n0.md'].content).toBe('note');
    // 五筆最後都有變更時間：n0 來自對帳，其餘四筆來自回填
    for (let i = 0; i < 5; i++) expect(shard[`個人學習/n${i}.md`].updatedAt).toEqual(expect.any(String));
    // 對帳已處理過的那筆不該再問一次 commits API
    expect(counters.commits).toBe(4);

    const idx = (await kv.get('meta:index', 'json')) as { notes: { updatedAt: string | null }[] };
    expect(idx.notes.every((n) => n.updatedAt)).toBe(true);
  });

  it('沒有任何事要做時不會爆', async () => {
    const counters = { commits: 0 };
    stubGitHub(counters);
    await worker.scheduled({} as never, env(), {} as never);
  });
});
