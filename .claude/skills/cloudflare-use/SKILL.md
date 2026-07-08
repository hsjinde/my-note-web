---
name: cloudflare-use
description: Query and modify Cloudflare D1 databases and R2 object storage from any project, fast and Windows-safe. Use whenever the user asks to check or query a D1 database, run SQL against Cloudflare, upload/download/list/delete R2 objects or buckets, verify data stored in Cloudflare, or reaches for wrangler d1/r2 commands. 只要使用者提到查 D1 資料庫、跑 SQL、上傳/下載/檢查 R2 檔案、驗證 Cloudflare 上的資料，就用這個 skill。
---

# Cloudflare Use (D1 & R2)

Always use these scripts instead of hand-built `npx wrangler` or raw curl. They hit the Cloudflare
REST API directly — no shell quoting, no wrangler cold start (~10x faster), and immune to the
Windows encoding traps that mojibake non-ASCII text (PowerShell writes BOMs; its console isn't
UTF-8). Wrangler is only used for `--local`, auto-picking wrangler@3 on Node < 22.

## Configuration (auto-discovered)

The scripts walk up from cwd to the project root (first dir with a token-bearing `.env`, a wrangler
config, or `.git`), then resolve each setting: explicit flag → env var → root `.env` → wrangler config.

- **Token** (the only required piece): `CLOUDFLARE_API_TOKEN`, needs D1 Edit + Workers R2 Storage
  Edit. If missing, guide the user: Cloudflare Dashboard → My Profile → API Tokens → create →
  paste into `.env`. Never echo the token into the conversation.
- **Account**: `CLOUDFLARE_ACCOUNT_ID`; auto-resolved via API when the token sees exactly one account.
- **D1 database**: `--db=<name-or-uuid>` → `CLOUDFLARE_D1_DATABASE_ID`/`.._NAME` → the `database_id`
  declared in any `wrangler.toml|json|jsonc` (project root or first-level subdir).
- **R2 bucket**: `--bucket=<name>` → `CLOUDFLARE_R2_BUCKET_NAME` → the `bucket_name` in wrangler config.

Anything unresolvable errors out with the exact fix; `r2.cjs buckets` discovers bucket names.

## D1

```
node .claude/skills/cloudflare-use/scripts/d1.cjs "SELECT * FROM users LIMIT 10"
node .claude/skills/cloudflare-use/scripts/d1.cjs migrations/001.sql
```

- The arg runs as a file if it's an existing `.sql` path (BOM auto-stripped), else as SQL text.
  Non-ASCII, quotes, emoji, multi-statement — all safe.
- Long values truncate at 200 chars (`--full` shows everything). `--local` targets the local dev DB.
- Remote writes hit live production data: SELECT the current rows and confirm with the user
  before any UPDATE/DELETE.

## R2

```
node .claude/skills/cloudflare-use/scripts/r2.cjs buckets
node .claude/skills/cloudflare-use/scripts/r2.cjs list [prefix] [--limit=100]
node .claude/skills/cloudflare-use/scripts/r2.cjs get <key> [local-file]
node .claude/skills/cloudflare-use/scripts/r2.cjs put <key> <local-file>   (content-type auto-detected)
node .claude/skills/cloudflare-use/scripts/r2.cjs delete <key>
```

## If something looks broken

- Garbled non-ASCII in the terminal but the data renders fine elsewhere → PowerShell console
  codepage; the data is OK. Verify with d1.cjs.
- Garbled text actually stored in D1 → a BOM'd SQL file was run outside these scripts; re-run the
  write through d1.cjs.
- `Wrangler requires at least Node.js v22` → only from manual wrangler runs on old machines; the
  scripts auto-pick wrangler@3 there.
