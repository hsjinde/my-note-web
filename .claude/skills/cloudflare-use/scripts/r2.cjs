#!/usr/bin/env node
// 操作 Cloudflare R2（bucket 自動探測：--bucket > CLOUDFLARE_R2_BUCKET_NAME > wrangler 設定）。
//
// 用法：
//   node r2.cjs buckets                       （列出帳號裡所有 bucket）
//   node r2.cjs list [prefix] [--limit=100]
//   node r2.cjs get <key> [local-file]        （省略 local-file 時存到 ./<key 檔名>）
//   node r2.cjs put <key> <local-file> [--content-type=<mime>]
//   node r2.cjs delete <key>
//   共通 flag：--bucket=<name>
//
// 全部走 Cloudflare REST API：不經 shell/wrangler，中文 key 用 URL encode，無編碼風險。
const fs = require('fs');
const path = require('path');
const { fatal, loadCreds, cfFetch, resolveBucket, encodeKey } = require('./_lib.cjs');

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const [cmd, ...rest] = positional;

const flagValue = (name) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : '';
};

let creds;
let bucket;
const objPath = (key) => `/r2/buckets/${bucket}/objects/${encodeKey(key)}`;

// 常見副檔名的 content-type（R2 會照存照回，網站上圖片能不能正確顯示靠這個）
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
};

function usage(code) {
  console.log('用法：node r2.cjs buckets | list [prefix] [--limit=100] | get <key> [file] | put <key> <file> [--content-type=<mime>] | delete <key>');
  process.exit(code);
}

async function listBuckets() {
  const body = await cfFetch(creds, '/r2/buckets');
  const buckets = (body.result && body.result.buckets) || body.result || [];
  for (const b of buckets) console.log(`${b.name}  (建立於 ${b.creation_date || '?'})`);
  console.log(`[共 ${buckets.length} 個 bucket]`);
}

async function list(prefix) {
  const limit = parseInt(flagValue('limit') || '100', 10);
  const params = new URLSearchParams({ per_page: String(limit) });
  if (prefix) params.set('prefix', prefix);
  const body = await cfFetch(creds, `/r2/buckets/${bucket}/objects?${params}`);
  for (const obj of body.result) {
    const kb = (obj.size / 1024).toFixed(1);
    console.log(`${obj.key}  (${kb} KB, ${obj.last_modified || obj.uploaded || ''})`);
  }
  const truncated = body.result_info && body.result_info.is_truncated;
  console.log(`[共 ${body.result.length} 筆${truncated ? '，已截斷（加 --limit 拿更多）' : ''}]`);
}

async function get(key, localFile) {
  const out = path.resolve(localFile || path.basename(key));
  const res = await cfFetch(creds, objPath(key), { raw: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`已下載：${bucket}/${key} → ${out}（${fs.statSync(out).size} bytes）`);
}

async function put(key, localFile) {
  if (!localFile || !fs.existsSync(path.resolve(localFile))) fatal(`找不到本機檔案：${localFile}`);
  const contentType = flagValue('content-type') || MIME[path.extname(key).toLowerCase()] || 'application/octet-stream';
  const data = fs.readFileSync(path.resolve(localFile));
  await cfFetch(creds, objPath(key), { method: 'PUT', body: data, contentType });
  console.log(`已上傳：${localFile} → ${bucket}/${key}（${data.length} bytes, ${contentType}）`);
}

async function del(key) {
  await cfFetch(creds, objPath(key), { method: 'DELETE' });
  console.log(`已刪除：${bucket}/${key}`);
}

(async () => {
  if (flags.includes('--help')) usage(0);
  creds = loadCreds();
  if (cmd === 'buckets') return listBuckets();
  bucket = resolveBucket(creds, flagValue('bucket'));
  if (cmd === 'list') await list(rest[0]);
  else if (cmd === 'get' && rest[0]) await get(rest[0], rest[1]);
  else if (cmd === 'put' && rest[0]) await put(rest[0], rest[1]);
  else if (cmd === 'delete' && rest[0]) await del(rest[0]);
  else usage(1);
})().catch((e) => {
  if (!e.isFatal) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  }
});
