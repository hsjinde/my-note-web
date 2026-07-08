/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { fullSync, incrementalSync, shardKey } from '../src/worker/sync';
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

function mockGH(files: Record<string, string>): GitHub {
  return {
    listMarkdownEntries: vi.fn(async () => Object.keys(files).map((path) => ({ path, sha: 'sha-' + path }))),
    getTarballBuffer: vi.fn(async () => makeTarballBuffer(files)),
    getFile: vi.fn(async (p: string) =>
      files[p] != null ? { content: files[p], sha: 'sha-' + p } : null),
    putFile: vi.fn(),
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
    expect(learnShard['個人學習/a.md']).toEqual({ content: '---\ntitle: A\n---\n內容A', sha: 'sha-個人學習/a.md' });
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

describe('incrementalSync', () => {
  it('added/modified 更新對應 shard、removed 從 shard 移除、重建索引', async () => {
    const kv = mockKV({
      'shard:個人學習': JSON.stringify({
        '個人學習/old.md': { content: '舊', sha: 's1' },
        '個人學習/gone.md': { content: '將刪', sha: 's2' },
      }),
    });
    const gh = mockGH({ '個人學習/new.md': '新檔', '個人學習/old.md': '改過' });
    const r = await incrementalSync(kv, gh, {
      commits: [
        { added: ['個人學習/new.md', '圖/x.png'], modified: ['個人學習/old.md'], removed: ['個人學習/gone.md'] },
      ],
    });
    expect(r).toEqual({ synced: 2, removed: 1 });
    const shard = (await kv.get('shard:個人學習', 'json')) as Record<string, { content: string; sha: string }>;
    expect(shard['個人學習/gone.md']).toBeUndefined();
    expect(shard['個人學習/old.md'].content).toBe('改過');
    expect(shard['個人學習/new.md'].content).toBe('新檔');
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string }[] };
    expect(idx.notes.map((n) => n.path).sort()).toEqual(['個人學習/new.md', '個人學習/old.md']);
  });

  it('沒有相關變更時不寫入任何東西', async () => {
    const kv = mockKV();
    const gh = mockGH({});
    const r = await incrementalSync(kv, gh, { commits: [{ added: ['圖/x.png'] }] });
    expect(r).toEqual({ synced: 0, removed: 0 });
    expect(await kv.get('meta:index')).toBeNull();
  });
});
