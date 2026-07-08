/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { parseTar, parseTarGz } from '../src/worker/tarball';

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

function makeHeader(name: string, size: number, typeflag: string, prefix = ''): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  const write = (str: string, offset: number) => header.set(enc.encode(str), offset);
  write(name.slice(0, 100), 0);
  write(octal(0o644, 8), 100); // mode
  write(octal(0, 8), 108); // uid
  write(octal(0, 8), 116); // gid
  write(octal(size, 12), 124); // size
  write(octal(0, 12), 136); // mtime
  header.fill(0x20, 148, 156); // chksum placeholder = spaces
  header[156] = typeflag.charCodeAt(0) || 0;
  write('ustar', 257);
  write('00', 263);
  if (prefix) write(prefix.slice(0, 155), 345);

  let sum = 0;
  for (const b of header) sum += b;
  const chk = sum.toString(8).padStart(6, '0') + '\0 ';
  write(chk, 148);
  return header;
}

function makeEntry(name: string, content: string, typeflag = '0', prefix = ''): Uint8Array {
  const contentBytes = new TextEncoder().encode(content);
  const header = makeHeader(name, contentBytes.length, typeflag, prefix);
  const paddedLen = Math.ceil(contentBytes.length / 512) * 512;
  const block = new Uint8Array(512 + paddedLen);
  block.set(header, 0);
  block.set(contentBytes, 512);
  return block;
}

function buildTar(entries: Uint8Array[]): Uint8Array {
  const totalLen = entries.reduce((s, e) => s + e.length, 0) + 1024; // two zero end blocks
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const e of entries) { out.set(e, offset); offset += e.length; }
  return out;
}

describe('parseTar', () => {
  it('解析純文字檔案內容與路徑', () => {
    const tar = buildTar([
      makeEntry('repo-abc/個人學習/a.md', '---\ntitle: A\n---\n內容'),
      makeEntry('repo-abc/好工具推薦/b.md', 'B 內容'),
    ]);
    const result = parseTar(tar);
    expect(result).toEqual([
      { path: 'repo-abc/個人學習/a.md', content: '---\ntitle: A\n---\n內容' },
      { path: 'repo-abc/好工具推薦/b.md', content: 'B 內容' },
    ]);
  });

  it('跳過目錄項目（typeflag 5）', () => {
    const tar = buildTar([
      makeEntry('repo-abc/個人學習/', '', '5'),
      makeEntry('repo-abc/個人學習/a.md', '內容'),
    ]);
    const result = parseTar(tar);
    expect(result).toEqual([{ path: 'repo-abc/個人學習/a.md', content: '內容' }]);
  });

  it('支援 GNU longname（typeflag L）處理超長路徑', () => {
    const longPath = 'repo-abc/工作專案/' + '很長的檔名測試'.repeat(10) + '.md';
    const tar = buildTar([
      makeEntry(longPath.slice(0, 100), longPath, 'L'),
      makeEntry('placeholder', '長路徑內容'),
    ]);
    const result = parseTar(tar);
    expect(result).toEqual([{ path: longPath, content: '長路徑內容' }]);
  });

  it('支援 ustar prefix 欄位組合完整路徑', () => {
    const tar = buildTar([makeEntry('c.md', '內容', '0', 'repo-abc/wiki')]);
    const result = parseTar(tar);
    expect(result).toEqual([{ path: 'repo-abc/wiki/c.md', content: '內容' }]);
  });
});

describe('parseTarGz', () => {
  it('解壓 gzip 後解析出正確內容', async () => {
    const tar = buildTar([makeEntry('repo-abc/個人學習/a.md', '你好世界')]);
    const gz = gzipSync(Buffer.from(tar));
    const result = await parseTarGz(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
    expect(result).toEqual([{ path: 'repo-abc/個人學習/a.md', content: '你好世界' }]);
  });
});
