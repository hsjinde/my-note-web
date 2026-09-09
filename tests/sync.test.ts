/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { fullSync, reconcileSync, backfillUpdatedAt, shardKey, MAX_FETCH_PER_SYNC } from '../src/worker/sync';
import { mockKV } from './helpers';
import type { GitHub } from '../src/worker/github';

function tarBlock(name: string, content: string): Uint8Array {
  const contentBytes = new TextEncoder().encode(content);
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  header.set(enc.encode(name.slice(0, 100)), 0);
  const writeOctal = (n: number, off: number, len: number) => header.set(enc.encode(n.toString(8).padStart(len - 1, '0') + '\0'), off);
  writeOctal(0o644, 100, 8);
  writeOctal(0, 108, 8);
  writeOctal(0, 116, 8);
  writeOctal(contentBytes.length, 124, 12);
  writeOctal(0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.set(enc.encode('ustar'), 257);
  header.set(enc.encode('00'), 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
  const padded = Math.ceil(contentBytes.length / 512) * 512;
  const block = new Uint8Array(512 + padded);
  block.set(header, 0);
  block.set(contentBytes, 512);
  return block;
}

function makeTarballBuffer(files: Record<string, string>): ArrayBuffer {
  const blocks = Object.entries(files).map(([path, content]) => tarBlock(`repo-abc/${path}`, content));
  const totalLen = blocks.reduce((s, b) => s + b.length, 0) + 1024;
  const tar = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of blocks) { tar.set(b, offset); offset += b.length; }
  const gz = gzipSync(Buffer.from(tar));
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
}

function mockGH(files: Record<string, string>, dates: Record<string, string> = {}): GitHub {
  return {
    listMarkdownEntries: vi.fn(async () => Object.keys(files).map((path) => ({ path, sha: 'sha-' + path }))),
    getTarballBuffer: vi.fn(async () => makeTarballBuffer(files)),
    getFile: vi.fn(async (p: string) =>
      files[p] != null ? { content: files[p], sha: 'sha-' + p } : null),
    putFile: vi.fn(),
    getLastCommitDate: vi.fn(async (p: string) => dates[p] ?? null),
  } as unknown as GitHub;
}

describe('shardKey', () => {
  it('依第一層資料夾產生 shard key', () => {
    expect(shardKey('個人學習/a.md')).toBe('shard:個人學習');
    expect(shardKey('wiki/k.md')).toBe('shard:wiki');
  });
});

describe('fullSync', () => {
  it('抓白名單+wiki、跳過其他、依資料夾分 shard 寫入、建索引', async () => {
    const kv = mockKV();
    const gh = mockGH({
      '個人學習/a.md': '---\ntitle: A\n---\n內容A',
      'wiki/k.md': 'wiki 內容',
      '日常/d.md': '不索引',
    });
    const r = await fullSync(kv, gh);
    expect(r.synced).toBe(2);
    const learnShard = (await kv.get('shard:個人學習', 'json')) as Record<string, { content: string; sha: string }>;
    expect(learnShard['個人學習/a.md']).toEqual({ content: '---\ntitle: A\n---\n內容A', sha: 'sha-個人學習/a.md', updatedAt: expect.any(String) });
    const wikiShard = (await kv.get('shard:wiki', 'json')) as Record<string, unknown>;
    expect(Object.keys(wikiShard)).toEqual(['wiki/k.md']);
    expect(await kv.get('shard:日常')).toBeNull();
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string }[] };
    expect(idx.notes.map((n) => n.path).sort()).toEqual(['wiki/k.md', '個人學習/a.md']);
  });

  it('重新同步時清除已不存在資料夾的舊 shard', async () => {
    const kv = mockKV({ 'shard:工作專案': JSON.stringify({ '工作專案/old.md': { content: '舊', sha: 's' } }) });
    const gh = mockGH({ '個人學習/a.md': '內容' });
    await fullSync(kv, gh);
    expect(await kv.get('shard:工作專案')).toBeNull();
  });
});

describe('reconcileSync', () => {
  it('不看 push payload，直接補上 KV 缺少的筆記', async () => {
    const kv = mockKV();
    const gh = mockGH({
      '個人學習/a.md': '內容A',
      'wiki/k.md': 'wiki 內容',
      '日常/d.md': '不索引',
    });
    const r = await reconcileSync(kv, gh);
    expect(r).toEqual({ synced: 2, removed: 0, pending: 0 });
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { sha: string }>;
    expect(shard['個人學習/a.md'].sha).toBe('sha-個人學習/a.md');
    expect(await kv.get('shard:日常')).toBeNull();
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string }[] };
    expect(idx.notes.map((n) => n.path).sort()).toEqual(['wiki/k.md', '個人學習/a.md']);
  });

  it('sha 相同的筆記不重抓，只抓真的有差異的', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/same.md': { content: '沒變', sha: 'sha-個人學習/same.md' },
      }),
    });
    const gh = mockGH({ '個人學習/same.md': '沒變', '個人學習/new.md': '新的' });
    const r = await reconcileSync(kv, gh);
    expect(r).toEqual({ synced: 1, removed: 0, pending: 0 });
    expect((gh.getFile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]))
      .toEqual(['個人學習/new.md']);
  });

  it('sha 不同的筆記會被重抓覆蓋', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/a.md': { content: '六月的舊版', sha: 'sha-過期' },
      }),
    });
    const gh = mockGH({ '個人學習/a.md': '九月的新版' });
    const r = await reconcileSync(kv, gh);
    expect(r).toEqual({ synced: 1, removed: 0, pending: 0 });
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { content: string; sha: string }>;
    expect(shard['個人學習/a.md']).toEqual({ content: '九月的新版', sha: 'sha-個人學習/a.md', updatedAt: expect.any(String) });
  });

  it('GitHub 上已不存在的筆記從 shard 移除', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/keep.md': { content: '留著', sha: 'sha-個人學習/keep.md' },
        '個人學習/gone.md': { content: '孤兒檔', sha: 'sha-個人學習/gone.md' },
      }),
    });
    const gh = mockGH({ '個人學習/keep.md': '留著' });
    const r = await reconcileSync(kv, gh);
    expect(r).toEqual({ synced: 0, removed: 1, pending: 0 });
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, unknown>;
    expect(Object.keys(shard)).toEqual(['個人學習/keep.md']);
  });

  it('單次抓取有上限，超出的留到下次並回報 pending', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_FETCH_PER_SYNC + 3; i++) files[`個人學習/n${i}.md`] = `內容${i}`;
    const kv = mockKV();
    const gh = mockGH(files);
    const r = await reconcileSync(kv, gh);
    expect(r).toEqual({ synced: MAX_FETCH_PER_SYNC, removed: 0, pending: 3 });
    expect((gh.getFile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(MAX_FETCH_PER_SYNC);
    const r2 = await reconcileSync(kv, gh);
    expect(r2).toEqual({ synced: 3, removed: 0, pending: 0 });
  });

  it('抓取超過上限時，孤兒檔的刪除仍在同一次完成（刪除不花 subrequest）', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_FETCH_PER_SYNC + 5; i++) files[`個人學習/n${i}.md`] = `內容${i}`;
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/orphan1.md': { content: '已從 GitHub 刪除', sha: 's1' },
        '個人學習/orphan2.md': { content: '已從 GitHub 刪除', sha: 's2' },
      }),
    });
    const gh = mockGH(files);
    const r = await reconcileSync(kv, gh);
    expect(r).toEqual({ synced: MAX_FETCH_PER_SYNC, removed: 2, pending: 5 });
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, unknown>;
    expect(shard['個人學習/orphan1.md']).toBeUndefined();
    expect(shard['個人學習/orphan2.md']).toBeUndefined();
  });

  it('完全一致時不寫入也不重建索引', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/a.md': { content: '一樣', sha: 'sha-個人學習/a.md' },
      }),
    });
    const gh = mockGH({ '個人學習/a.md': '一樣' });
    const r = await reconcileSync(kv, gh);
    expect(r).toEqual({ synced: 0, removed: 0, pending: 0 });
    expect(await kv.get('meta:index')).toBeNull();
  });
});

const today = () => new Date().toISOString().slice(0, 10);

describe('updatedAt（內容變更時間）', () => {
  it('reconcileSync 抓到新內容時記錄變更時間，並帶進索引', async () => {
    const kv = mockKV();
    const gh = mockGH({ '個人學習/a.md': '內容A' });
    await reconcileSync(kv, gh);
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { updatedAt?: string }>;
    expect(shard['個人學習/a.md'].updatedAt!.slice(0, 10)).toBe(today());
    const idx = (await kv.get('meta:index', 'json')) as { notes: { updatedAt: string | null }[] };
    expect(idx.notes[0].updatedAt).toBe(today());
  });

  it('sha 沒變的筆記沿用原本的 updatedAt，只有真的變更才更新', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/same.md': { content: '一樣', sha: 'sha-個人學習/same.md', updatedAt: '2026-06-05T00:00:00.000Z' },
        '個人學習/changed.md': { content: '舊', sha: 'sha-過期', updatedAt: '2026-06-05T00:00:00.000Z' },
      }),
    });
    const gh = mockGH({ '個人學習/same.md': '一樣', '個人學習/changed.md': '新' });
    await reconcileSync(kv, gh);
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { updatedAt?: string }>;
    expect(shard['個人學習/same.md'].updatedAt).toBe('2026-06-05T00:00:00.000Z');
    expect(shard['個人學習/changed.md'].updatedAt!.slice(0, 10)).toBe(today());
  });

  it('fullSync 整批重寫時不會把既有的 updatedAt 清掉', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/a.md': { content: '內容A', sha: 'sha-個人學習/a.md', updatedAt: '2026-06-05T00:00:00.000Z' },
      }),
    });
    const gh = mockGH({ '個人學習/a.md': '內容A' });
    await fullSync(kv, gh);
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { updatedAt?: string }>;
    expect(shard['個人學習/a.md'].updatedAt).toBe('2026-06-05T00:00:00.000Z');
  });
});

describe('backfillUpdatedAt', () => {
  const twoNotes = {
    'shard:個人學習': JSON.stringify({
      '個人學習/a.md': { content: 'A', sha: 's1' },
      '個人學習/b.md': { content: 'B', sha: 's2', updatedAt: '2026-01-01T00:00:00Z' },
    }),
  };

  it('只補沒有 updatedAt 的筆記，值取自該檔最後一個 commit', async () => {
    const kv = mockKV(twoNotes);
    const gh = mockGH({ '個人學習/a.md': 'A', '個人學習/b.md': 'B' },
      { '個人學習/a.md': '2026-09-02T08:59:47Z', '個人學習/b.md': '2026-08-01T00:00:00Z' });
    const r = await backfillUpdatedAt(kv, gh);
    expect(r).toEqual({ filled: 1, pending: 0 });
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { updatedAt?: string }>;
    expect(shard['個人學習/a.md'].updatedAt).toBe('2026-09-02T08:59:47Z');
    expect(shard['個人學習/b.md'].updatedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('回填後索引帶得到日期', async () => {
    const kv = mockKV(twoNotes);
    const gh = mockGH({}, { '個人學習/a.md': '2026-09-02T08:59:47Z' });
    await backfillUpdatedAt(kv, gh);
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string; updatedAt: string | null }[] };
    expect(idx.notes.find((n) => n.path === '個人學習/a.md')!.updatedAt).toBe('2026-09-02');
  });

  it('一次最多補到上限，其餘回報 pending', async () => {
    const shard: Record<string, { content: string; sha: string }> = {};
    const dates: Record<string, string> = {};
    for (let i = 0; i < MAX_FETCH_PER_SYNC + 4; i++) {
      shard[`個人學習/n${i}.md`] = { content: `內容${i}`, sha: `s${i}` };
      dates[`個人學習/n${i}.md`] = '2026-09-02T08:59:47Z';
    }
    const kv = mockKV({ 'shard:個人學習': JSON.stringify(shard) });
    const gh = mockGH({}, dates);
    expect(await backfillUpdatedAt(kv, gh)).toEqual({ filled: MAX_FETCH_PER_SYNC, pending: 4 });
    expect(await backfillUpdatedAt(kv, gh)).toEqual({ filled: 4, pending: 0 });
  });

  it('全部都有 updatedAt 時不寫入也不重建索引', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/a.md': { content: 'A', sha: 's1', updatedAt: '2026-01-01T00:00:00Z' },
      }),
    });
    const gh = mockGH({});
    expect(await backfillUpdatedAt(kv, gh)).toEqual({ filled: 0, pending: 0 });
    expect(await kv.get('meta:index')).toBeNull();
  });
});
