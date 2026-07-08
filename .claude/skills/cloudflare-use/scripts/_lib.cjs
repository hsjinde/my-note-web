// cloudflare-use 共用函式庫：專案根目錄/憑證/資源自動探測 + Cloudflare REST API 呼叫。
//
// 主要路徑是 REST API（fetch）：不經 shell、不經 npx/wrangler，所以沒有
// Windows 編碼陷阱（PowerShell BOM、cmd.exe codepage），速度也快一個數量級。
// wrangler 只用在 REST 到不了的地方（d1 --local 的本機 miniflare DB）。
//
// 泛用設計：不寫死任何專案的資料庫/bucket 名稱。解析順序一律是
//   明確 flag > 環境變數 > repo root 的 .env > 專案內 wrangler 設定檔 > API 查詢。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API = 'https://api.cloudflare.com/client/v4';

// 印出錯誤後「拋出」而非 process.exit()：Windows 上還有 pending socket 時硬退出
// 會觸發 libuv assertion。讓 event loop 自然收尾，exit code 靠 exitCode。
function fatal(msg) {
  console.error('ERROR:', msg);
  process.exitCode = 1;
  const err = new Error(msg);
  err.isFatal = true; // 已印過，最外層 catch 不要重印
  throw err;
}

// 從 cwd 向上找專案根目錄：優先取「.env 裡有 CLOUDFLARE_API_TOKEN 的目錄」，
// 其次是有 wrangler 設定檔的目錄，再其次 .git。都沒有就用 cwd（憑證可能在環境變數）。
const WRANGLER_FILES = ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'];

function findRoot() {
  let dir = process.cwd();
  let firstWrangler = '';
  let firstGit = '';
  for (let i = 0; i < 12; i++) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath) && fs.readFileSync(envPath, 'utf8').includes('CLOUDFLARE_API_TOKEN=')) {
      return dir;
    }
    if (!firstWrangler && WRANGLER_FILES.some((f) => fs.existsSync(path.join(dir, f)))) firstWrangler = dir;
    if (!firstGit && fs.existsSync(path.join(dir, '.git'))) firstGit = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return firstWrangler || firstGit || process.cwd();
}

// 掃 root 與第一層子目錄的 wrangler 設定，撈出 D1/R2 綁定（toml 與 json 都用同一組 regex 抓）。
function findWranglerConfigs(root) {
  const dirs = [root];
  const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'coverage']);
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name)) {
        dirs.push(path.join(root, entry.name));
      }
    }
  } catch { /* root 讀不到就只掃 root 自己 */ }

  const configs = [];
  for (const dir of dirs) {
    for (const name of WRANGLER_FILES) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const grabAll = (re) => [...text.matchAll(re)].map((m) => m[1]);
      configs.push({
        file,
        dir,
        databaseIds: grabAll(/database_id["\s]*[:=]\s*"([^"]+)"/g),
        databaseNames: grabAll(/database_name["\s]*[:=]\s*"([^"]+)"/g),
        buckets: grabAll(/bucket_name["\s]*[:=]\s*"([^"]+)"/g),
      });
    }
  }
  return configs;
}

// 憑證與設定：環境變數 > repo root .env > wrangler 設定探測。
function loadCreds() {
  const root = findRoot();
  const fromEnvFile = {};
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_DATABASE_NAME', 'CLOUDFLARE_R2_BUCKET_NAME']) {
      const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (m) fromEnvFile[key] = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  const pick = (key) => process.env[key] || fromEnvFile[key] || '';

  const creds = {
    root,
    token: pick('CLOUDFLARE_API_TOKEN'),
    accountId: pick('CLOUDFLARE_ACCOUNT_ID'),
    envDbId: pick('CLOUDFLARE_D1_DATABASE_ID'),
    envDbName: pick('CLOUDFLARE_D1_DATABASE_NAME'),
    envBucket: pick('CLOUDFLARE_R2_BUCKET_NAME'),
    configs: findWranglerConfigs(root),
  };
  if (!creds.token) {
    fatal(
      `找不到 CLOUDFLARE_API_TOKEN（環境變數或 ${envPath}）。\n` +
      '請到 Cloudflare Dashboard → My Profile → API Tokens 建立 token（權限：Account/D1 Edit + Account/Workers R2 Storage Edit），寫入 .env。'
    );
  }
  return creds;
}

// 低階 REST 呼叫。回傳解析後的 JSON body，或 Response（raw=true，給 R2 get 下載檔案用）。
async function api(token, absPath, { method = 'GET', body, contentType, raw = false } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  const res = await fetch(`${API}${absPath}`, { method, headers, body });
  if (raw) {
    if (!res.ok) fatal(`API ${res.status}：${(await res.text()).slice(0, 500)}`);
    return res;
  }
  const json = await res.json().catch(() => null);
  if (!json || json.success === false) {
    const errors = json && json.errors ? json.errors.map((e) => `${e.code} ${e.message}`).join('; ') : `HTTP ${res.status}`;
    fatal(`API 失敗：${errors}`);
  }
  return json;
}

// account id 沒設時用 token 反查：剛好一個帳號就直接用，多個才要求使用者指定。
async function resolveAccountId(creds) {
  if (creds.accountId) return creds.accountId;
  const json = await api(creds.token, '/accounts');
  const accounts = json.result || [];
  if (accounts.length === 1) {
    creds.accountId = accounts[0].id;
    return creds.accountId;
  }
  if (accounts.length === 0) fatal('這個 token 看不到任何帳號，請確認 token 權限。');
  fatal(
    `token 可存取多個帳號，請在 .env 設 CLOUDFLARE_ACCOUNT_ID。可選：\n` +
    accounts.map((a) => `  ${a.id}  ${a.name}`).join('\n')
  );
}

// 相對 /accounts/{id} 的 REST 呼叫（大多數端點）。
async function cfFetch(creds, relPath, opts = {}) {
  const accountId = await resolveAccountId(creds);
  return api(creds.token, `/accounts/${accountId}${relPath}`, opts);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 解析 D1 目標：--db（名稱或 uuid）> 環境變數 > wrangler 設定探測。名稱經 API 換成 uuid。
async function resolveDbId(creds, dbArg) {
  let cand = dbArg || creds.envDbId || creds.envDbName;
  if (!cand) {
    const ids = [...new Set(creds.configs.flatMap((c) => c.databaseIds))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) {
      fatal(`專案裡找到多個 D1 database_id，請用 --db= 指定：\n${creds.configs.map((c) => `  ${c.file}: ${c.databaseIds.join(', ')}`).join('\n')}`);
    }
    fatal('找不到 D1 資料庫：請用 --db=<名稱或uuid>，或設 CLOUDFLARE_D1_DATABASE_ID，或在專案的 wrangler 設定裡宣告 d1 綁定。');
  }
  if (UUID_RE.test(cand)) return cand;
  // 是名稱：查 API 換 uuid
  const json = await cfFetch(creds, `/d1/database?name=${encodeURIComponent(cand)}&per_page=100`);
  const hit = (json.result || []).find((d) => d.name === cand);
  if (!hit) {
    const names = (json.result || []).map((d) => d.name).slice(0, 10).join(', ');
    fatal(`帳號裡沒有名為「${cand}」的 D1 資料庫。${names ? `相近的有：${names}` : ''}`);
  }
  return hit.uuid;
}

// 解析 R2 bucket：--bucket > 環境變數 > wrangler 設定探測（剛好一個才自動採用）。
function resolveBucket(creds, bucketArg) {
  if (bucketArg) return bucketArg;
  if (creds.envBucket) return creds.envBucket;
  const buckets = [...new Set(creds.configs.flatMap((c) => c.buckets))];
  if (buckets.length === 1) return buckets[0];
  if (buckets.length > 1) fatal(`專案裡找到多個 R2 bucket（${buckets.join(', ')}），請用 --bucket= 指定。`);
  fatal('找不到 R2 bucket：請用 --bucket=<名稱> 或設 CLOUDFLARE_R2_BUCKET_NAME（可先跑 r2.cjs buckets 列出帳號裡的 bucket）。');
}

// R2 物件 key 可能含中文/空白，逐段 URL encode（保留 / 分隔）。
function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

// Wrangler 後備（僅 d1 --local 用）。Wrangler 4 要 Node >= 22，舊機器自動退回 wrangler@3。
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
const WRANGLER = nodeMajor >= 22 ? 'wrangler' : 'wrangler@3';

function runWrangler(args, opts = {}) {
  try {
    return execSync(`npx ${WRANGLER} ${args}`, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      cwd: opts.cwd || process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (e.stdout) console.error(String(e.stdout).trim());
    if (e.stderr) console.error(String(e.stderr).trim());
    fatal(`wrangler 執行失敗（exit ${e.status}）`);
  }
}

module.exports = { fatal, loadCreds, cfFetch, resolveDbId, resolveBucket, encodeKey, runWrangler };
