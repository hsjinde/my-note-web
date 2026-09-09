# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# my-note-web

Obsidian vault（[hsjinde/my-note](https://github.com/hsjinde/my-note)）的公開閱讀網站：React + Vite SPA + Cloudflare Worker（Hono）+ KV + Workers AI。支援 push 自動更新（webhook 增量同步）、網頁編輯回寫 GitHub、AI 問答（問資料庫）。

## 常用指令

```bash
npm install                          # 安裝依賴
npx wrangler dev                     # 終端 1：Worker（API + 本機 KV 模擬），http://127.0.0.1:8787
npm run dev                          # 終端 2：Vite 前端，http://localhost:5173，/api 會 proxy 到 8787
npx vitest run                       # 跑全部測試
npx vitest run tests/sync.test.ts    # 跑單一測試檔
npx tsc --noEmit                     # 型別檢查
npm run build                        # Vite build 到 dist/
npm run deploy                       # build + wrangler deploy —— 直接上正式站 note.19980803.xyz，沒有 staging
```

本機開發需在專案根目錄建立 `.dev.vars`（已 gitignore）：`SITE_PASSWORD`、`SESSION_SECRET`、`WEBHOOK_SECRET`、`GITHUB_TOKEN`。非機密設定（`GITHUB_REPO`、`GITHUB_BRANCH`、`AI_MODEL`）在 [wrangler.jsonc](wrangler.jsonc) 的 `vars`。

**注意**：Workers AI binding 沒有本機模擬——即使在本機 `wrangler dev`，呼叫 `/api/ask` 也會用真實 Cloudflare 帳號的 Workers AI 免費額度跑推論。測試 AI 相關邏輯以 vitest（mock）為主，不要反覆打 `/api/ask` 驗證。

## 架構

單一 Cloudflare Worker（[src/worker/index.ts](src/worker/index.ts)，Hono）同時服務 `dist/` 的 SPA 靜態資產與所有 `/api/*` 路由。原始碼分三區：

- `src/worker/` — Worker 端：路由（index.ts）、同步（sync.ts + tarball.ts）、內容解析與索引（content.ts）、GitHub Contents API（github.ts）、session 認證（auth.ts）、webhook 簽章驗證（webhook.ts）、AI 問答（ask.ts）。
- `src/app/` — React SPA：hash routing（router.ts，`#/note/<path>`、`#/tag/<tag>`、`#/db`，無 router 套件）、API client（api.ts）、markdown 渲染（markdown.ts，markdown-it + wikilink）、pages/ 與 components/。
- `src/shared/` — 前後端共用：`folders.ts`（`PUBLIC_FOLDERS` 白名單唯一定義處）、`types.ts`（`NoteMeta`/`SiteIndex`）、`quicknote.ts`（靈感速記格式）。

### 資料流與 KV 資料模型

```
my-note push → /api/webhook（驗簽＋比對分支）→ reconcileSync：tree 全量 sha 對帳，只抓有差異的
登入後 POST /api/sync            → fullSync：tree API 取 sha + tarball 取全文，整批重寫
登入後 POST /api/reconcile       → reconcileSync：同 webhook 那條，分批補齊落後的內容
網頁編輯 PUT /api/note/*         → GitHub putFile（帶 sha，衝突回 409）→ 更新 KV → 重建索引
```

KV（binding `NOTES`）只有兩類 key：

- `shard:<頂層資料夾>` → `Record<path, { content, sha }>`——每個頂層資料夾一個 shard（見 sync.ts 的 `shardKey`），存筆記原文與 GitHub blob sha。
- `meta:index` → `SiteIndex`——由全部 shard 重建（`rebuildIndexFromKV`），含 title/tags/excerpt/wikilink 解析（content.ts 的 `buildIndex`）。

webhook 走的是**對帳**而不是增量：`reconcileSync` 不看 push payload，改用 `listMarkdownEntries()` 拿 tree 上的完整 blob sha 清單跟 KV 比對，只抓 sha 不同或缺少的檔案，並移除 tree 上已不存在的。這是刻意的——只信任 payload 的話，webhook 漏送一次那些檔案就永久漏掉（2026-09 曾因此累積 117 篇缺漏、55 篇過期）。單次對帳最多抓 `MAX_FETCH_PER_RECONCILE`（40）個檔案以免超過 Workers 的 subrequest 上限，其餘由 `pending` 回報並留給下一次 push。相對地 `listMarkdownEntries()` 在 tree 被截斷時會丟錯，避免拿半套清單去比對而誤刪整批筆記。

**任何寫入 KV 筆記內容的路徑（編輯、新增、quicknote、同步）都必須跟著重建索引**，現有 handler 都遵守這個慣例。

### 公開／私有邊界（最重要的不變量）

- `PUBLIC_FOLDERS`（[src/shared/folders.ts](src/shared/folders.ts)：個人學習、好工具推薦、工作專案、靈感）是公開閱讀＋可寫回的白名單。
- `wiki/`（content.ts 的 `AI_EXTRA_FOLDERS`）會被同步與索引（`isIndexedPath`），供 AI 問答使用，但 `NoteMeta.private = true`，`publicIndex()` 會把它連同指向它的 `linksTo` 一併過濾。**wiki 內容永遠不得出現在公開頁面與公開 API**——`/api/index` 走 `publicIndex`，`/api/note/*` 讀寫都先過 `isPublicPath`。

### 認證

單一密碼（`SITE_PASSWORD`）→ HMAC 簽章的 session cookie（30 天，auth.ts）。閱讀完全公開；所有寫入端點與 `/api/ask` 走 `requireAuth` middleware。前端用 `requireLogin()` 包住需登入的動作，未登入時彈出登入框、登入後續跑原動作。

### AI 問答

ask.ts：對 `meta:index` 做關鍵字計分（中文取 bigram、英數取 token），選 top 4 筆記全文塞進 system prompt，呼叫 Workers AI（模型由 `AI_MODEL` var 指定）。純檢索式，無 embedding。

## 測試

vitest（node environment，設定在 [vite.config.ts](vite.config.ts)），測試都在 `tests/`。[tests/helpers.ts](tests/helpers.ts) 提供 `mockKV()`；路由測試直接 import Hono `app` 用 `app.request()` 打，GitHub/AI 用 stub。不需要 wrangler 或網路。

## Design Context

任何涉及 UI 的變更，先讀這兩份：

- [PRODUCT.md](PRODUCT.md) — 定位（product register）、讀者、品牌個性（溫暖、安靜、書卷氣）、反面參考（拒絕 SaaS 行銷風）、五條設計原則。
- [DESIGN.md](DESIGN.md) — 視覺系統「書房紙頁」：色彩 token（`src/app/theme.css` 的 CSS 變數為唯一來源，亮暗雙版）、三聲部字型（Noto Serif TC 標題／Noto Sans TC 內文／IBM Plex Mono 後設資訊）、平面優先的層級策略、元件規格與 Do/Don't。

速記三條硬規則：顏色一律走 CSS 變數且亮暗都要給；書籤橘（`--ac`）覆蓋率 ≤10%；新介面要在 375px 手機視窗驗證過才算完成。
