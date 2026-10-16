import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/worker/index';
import { readNote, writeNote, noteKey, migrateShardsToNotes, reconcileSync, MIGRATION_KEY } from '../src/worker/sync';
import { mockKV } from './helpers';
import type { GitHub } from '../src/worker/github';

function env(kvInit: Record<string, string> = {}) {
  return {
    NOTES: mockKV(kvInit),
    SITE_PASSWORD: 'pw', SESSION_SECRET: 'ss', WEBHOOK_SECRET: 'ws',
    GITHUB_TOKEN: 'tok', GITHUB_REPO: 'hsjinde/my-note', GITHUB_BRANCH: 'main',
    AI_MODEL: 'test-model', AI: { run: async () => ({ response: 'ok' }) },
  } as never;
}

const PATH = '個人學習/a.md';
const url = (p: string) => `/api/note/${encodeURIComponent(p)}`;

describe('readNote', () => {
  it('有 note: key 時不去碰 shard', async () => {
    const kv = mockKV({ [noteKey(PATH)]: JSON.stringify({ content: '# A', sha: 's1' }) });
    const spy = vi.spyOn(kv, 'get');
    const { note, fromShard } = await readNote(kv, PATH);
    expect(note).toEqual({ content: '# A', sha: 's1' });
    expect(fromShard).toBe(false);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([noteKey(PATH)]);
  });
  it('沒有 note: key 時退回 shard，並標記 fromShard', async () => {
    const kv = mockKV({ 'shard:個人學習': JSON.stringify({ [PATH]: { content: '# A', sha: 's1' } }) });
    const { note, fromShard } = await readNote(kv, PATH);
    expect(note).toEqual({ content: '# A', sha: 's1' });
    expect(fromShard).toBe(true);
  });
  it('兩邊都沒有就回 null', async () => {
    const { note, fromShard } = await readNote(mockKV(), PATH);
    expect(note).toBeNull();
    expect(fromShard).toBe(false);
  });
});

describe('GET /api/note/*', () => {
  it('只有 note: key（沒有 shard）也讀得到', async () => {
    const e = env({ [noteKey(PATH)]: JSON.stringify({ content: '# A', sha: 's1' }) });
    const res = await app.request(url(PATH), {}, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: PATH, content: '# A', sha: 's1' });
  });
  it('從 shard 讀到的會順手補寫 note: key，下次就不必再 parse 整包', async () => {
    const e = env({ 'shard:個人學習': JSON.stringify({ [PATH]: { content: '# A', sha: 's1' } }) });
    const kv = (e as unknown as { NOTES: ReturnType<typeof mockKV> }).NOTES;
    expect(kv.store.has(noteKey(PATH))).toBe(false);
    const res = await app.request(url(PATH), {}, e);
    expect(res.status).toBe(200);
    expect(JSON.parse(kv.store.get(noteKey(PATH))!)).toEqual({ content: '# A', sha: 's1' });
  });
  it('wiki 的 note: key 也不給讀', async () => {
    const e = env({ [noteKey('wiki/k.md')]: JSON.stringify({ content: '秘密', sha: 's2' }) });
    expect((await app.request(url('wiki/k.md'), {}, e)).status).toBe(404);
  });
});

describe('migrateShardsToNotes', () => {
  const shardA = JSON.stringify({
    '個人學習/1.md': { content: '1', sha: 'a1' },
    '個人學習/2.md': { content: '2', sha: 'a2' },
    '個人學習/3.md': { content: '3', sha: 'a3' },
  });
  const shardB = JSON.stringify({ '靈感/x.md': { content: 'x', sha: 'b1' } });

  it('分批搬、會接續進度，全部搬完後回 done', async () => {
    const kv = mockKV({ 'shard:個人學習': shardA, 'shard:靈感': shardB });
    const first = await migrateShardsToNotes(kv, 2);
    expect(first.migrated).toBe(2);
    expect(first.done).toBe(false);
    expect([...kv.store.keys()].filter((k) => k.startsWith('note:')).length).toBe(2);

    const second = await migrateShardsToNotes(kv, 2);
    expect(second.migrated).toBe(1); // 個人學習 只剩一篇，接著換下一個 shard
    const third = await migrateShardsToNotes(kv, 2);
    expect(third.done).toBe(true);

    const keys = [...kv.store.keys()].filter((k) => k.startsWith('note:')).sort();
    expect(keys).toEqual([
      noteKey('個人學習/1.md'), noteKey('個人學習/2.md'),
      noteKey('個人學習/3.md'), noteKey('靈感/x.md'),
    ].sort());
    expect(JSON.parse(kv.store.get(noteKey('靈感/x.md'))!)).toEqual({ content: 'x', sha: 'b1' });
  });

  it('搬完之後再呼叫不會重做', async () => {
    const kv = mockKV({ 'shard:靈感': shardB });
    await migrateShardsToNotes(kv, 10);
    const again = await migrateShardsToNotes(kv, 10);
    expect(again.migrated).toBe(0);
    expect(again.done).toBe(true);
    expect(JSON.parse(kv.store.get(MIGRATION_KEY)!).done).toBe(true);
  });

  it('沒有 shard 可搬時直接標記完成', async () => {
    const kv = mockKV();
    expect((await migrateShardsToNotes(kv, 10)).done).toBe(true);
  });
});

describe('reconcileSync 與 note: key', () => {
  function mockGH(files: Record<string, string>): GitHub {
    return {
      listMarkdownEntries: vi.fn(async () => Object.keys(files).map((path) => ({ path, sha: 'sha-' + path }))),
      getFile: vi.fn(async (p: string) => (files[p] != null ? { content: files[p], sha: 'sha-' + p } : null)),
      getTarballBuffer: vi.fn(),
      putFile: vi.fn(),
      getLastCommitDate: vi.fn(),
    } as unknown as GitHub;
  }

  it('抓回來的新內容會同時寫進 note: key', async () => {
    const kv = mockKV();
    await reconcileSync(kv, mockGH({ [PATH]: '新內容' }));
    expect(JSON.parse(kv.store.get(noteKey(PATH))!).content).toBe('新內容');
  });

  it('GitHub 上已刪除的筆記，note: key 也要跟著刪掉', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({ [PATH]: { content: '舊', sha: 'old' } }),
      [noteKey(PATH)]: JSON.stringify({ content: '舊', sha: 'old' }),
    });
    const r = await reconcileSync(kv, mockGH({}));
    expect(r.removed).toBe(1);
    expect(kv.store.has(noteKey(PATH))).toBe(false);
  });

  it('內容更新後 note: key 不會留著舊的', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({ [PATH]: { content: '舊', sha: 'stale' } }),
      [noteKey(PATH)]: JSON.stringify({ content: '舊', sha: 'stale' }),
    });
    await reconcileSync(kv, mockGH({ [PATH]: '新內容' }));
    expect(JSON.parse(kv.store.get(noteKey(PATH))!).content).toBe('新內容');
  });
});

describe('writeNote', () => {
  it('寫進以 note: 為前綴的 key', async () => {
    const kv = mockKV();
    await writeNote(kv, PATH, { content: 'c', sha: 's' });
    expect([...kv.store.keys()]).toEqual([noteKey(PATH)]);
  });
});
