#!/usr/bin/env node
// 對 Cloudflare D1 執行 SQL（字串或 .sql 檔皆可）。
//
// 用法：
//   node d1.cjs "SELECT * FROM users LIMIT 10"
//   node d1.cjs path/to/statements.sql
//   flags: --db=<名稱或uuid>（省略時自動探測，見 _lib.cjs）
//          --full（長欄位不截斷）  --local（打本機 dev DB，需經 wrangler）
//
// 遠端走 D1 REST query API：SQL 放在 UTF-8 JSON body 裡，不經 shell，
// 中文/引號/emoji 都安全，也比 npx wrangler 快一個數量級。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fatal, loadCreds, cfFetch, resolveDbId, runWrangler } = require('./_lib.cjs');

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length !== 1 || flags.includes('--help')) {
  console.log('用法：node d1.cjs "<SQL>" | <file.sql>  [--db=<name-or-uuid>] [--full] [--local]');
  process.exit(positional.length === 1 ? 0 : 1);
}

const dbArg = (flags.find((f) => f.startsWith('--db=')) || '').split('=').slice(1).join('=');
const full = flags.includes('--full');
const local = flags.includes('--local');

// 引數是存在的 .sql 檔就整檔執行，否則視為 SQL 字串。
const input = positional[0];
let sql = /\.sql$/i.test(input) && fs.existsSync(path.resolve(input))
  ? fs.readFileSync(path.resolve(input), 'utf8')
  : input;
if (sql.charCodeAt(0) === 0xFEFF) sql = sql.slice(1); // 去 BOM——PowerShell 寫的檔會帶，是中文亂碼的頭號元兇

// 每個 statement 一個 result：{ results: [rows], success, meta }
function printResults(data) {
  for (const result of data) {
    const rows = result.results || [];
    rows.forEach((row, i) => {
      if (rows.length > 1) console.log(`--- Row ${i + 1} ---`);
      for (const [key, value] of Object.entries(row)) {
        const display = !full && typeof value === 'string' && value.length > 200
          ? `${value.substring(0, 200)}…（共 ${value.length} 字，--full 看全文）`
          : value;
        console.log(`${key}: ${display}`);
      }
    });
    if (rows.length === 0 && result.success) console.log('OK（無回傳列）');
    if (result.meta) {
      console.log(`[rows read ${result.meta.rows_read} / written ${result.meta.rows_written} / ${result.meta.duration}ms]`);
    }
  }
}

(async () => {
  const creds = loadCreds();

  if (local) {
    // 本機 miniflare DB 只有 wrangler 摸得到；在宣告 d1 綁定的 wrangler 設定所在目錄執行，
    // SQL 經 BOM-free temp 檔避開 shell 轉義。
    const cfg = creds.configs.find((c) => c.databaseNames.length > 0);
    if (!cfg && !dbArg) fatal('--local 需要專案裡有宣告 d1 綁定的 wrangler 設定（或用 --db=<名稱> 指定）。');
    const dbName = dbArg || cfg.databaseNames[0];
    const cwd = cfg ? cfg.dir : creds.root;
    const tmpFile = path.join(os.tmpdir(), `d1-${Date.now()}.sql`);
    fs.writeFileSync(tmpFile, sql, 'utf8');
    try {
      const output = runWrangler(`d1 execute ${dbName} --file="${tmpFile}" --local --json`, { cwd });
      const start = output.indexOf('[');
      if (start >= 0) printResults(JSON.parse(output.substring(start)));
      else console.log(output.trim());
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* temp 檔清不掉無妨 */ }
    }
    return;
  }

  const dbId = await resolveDbId(creds, dbArg);
  const json = await cfFetch(creds, `/d1/database/${dbId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql }),
    contentType: 'application/json',
  });
  printResults(json.result);
})().catch((e) => {
  if (!e.isFatal) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  }
});
