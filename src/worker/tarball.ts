export interface TarEntry {
  path: string;
  content: string;
}

function readCString(bytes: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

function readOctal(bytes: Uint8Array, start: number, len: number): number {
  const s = readCString(bytes, start, len).trim();
  return s ? parseInt(s, 8) : 0;
}

export function parseTar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  const decoder = new TextDecoder();
  let offset = 0;
  let longName: string | null = null;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker

    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0);
    const prefix = readCString(header, 345, 155);
    let name = readCString(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;

    offset += 512;
    const contentBytes = buf.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (typeflag === 'L') {
      longName = decoder.decode(contentBytes).replace(/\0+$/, '');
      continue;
    }
    if (longName) {
      name = longName;
      longName = null;
    }
    if (typeflag === '0' || typeflag === '\0') {
      entries.push({ path: name, content: decoder.decode(contentBytes) });
    }
  }
  return entries;
}

export async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseTarGz(buf: ArrayBuffer): Promise<TarEntry[]> {
  return parseTar(await gunzip(buf));
}
