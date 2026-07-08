# my-note-web 設計規格

- 日期：2026-07-08
- 狀態：已確認
- 取代：`Quartz 閱讀網站建置規格.md`（原 Quartz + GitHub Pages 方案，因新增「網頁編輯回寫」與「AI 問答」需求改為本方案）
- 設計稿：`Quartz 閱讀網站建置規格-handoff/quartz/project/Prototype.dc.html`（實作以此為準）

## 1. 目標

把 GitHub repo `hsjinde/my-note`（Obsidian vault）做成公開閱讀網站，並支援：

1. **推送自動更新**：my-note 推送後網站幾秒內反映新內容。
2. **網頁編輯回寫**：在網頁上編輯筆記，自動 commit 回 hsjinde/my-note。
3. **AI 問答（問資料庫）**：透過 Cloudflare Workers AI，根據筆記內容（含 wiki/）回答問題。

## 2. 決策摘要

| 項目 | 決定 |
|---|---|
| 架構 | Cloudflare Worker 單一專案：靜態前端 + API + KV + Workers AI |
| 前端 | React + Vite SPA，pixel-faithful 還原 Prototype.dc.html；不用 Quartz |
| 後端路由 | Hono |
| 內容同步 | GitHub webhook → Worker 拉取變更 → 寫入 KV（不重新部署） |
| 編輯回寫 | GitHub Contents API commit（fine-grained PAT） |
| 身分驗證 | 簡單密碼登入（Worker secret），HMAC 簽章 HttpOnly cookie，30 天 |
| 公開閱讀範圍 | 白名單：`個人學習/`、`好工具推薦/`、`工作專案/` |
| AI 索引範圍 | 白名單 + `wiki/`（wiki 內容永不出現在公開頁面與公開 API） |
| AI 作法 | v1 輕量 RAG：關鍵字檢索挑前幾篇筆記塞入 prompt；不用 Vectorize |
| Workers AI | Worker 原生 AI binding（部署在使用者自己的 CF 帳號，不需額外 token） |

## 3. 架構

```
hsjinde/my-note (GitHub)
   │  push → GitHub webhook（幾秒內）
   ▼
Cloudflare Worker ──── 靜態前端（SPA，還原 Prototype.dc.html）
   │                ├─ /api/*：內容、搜尋索引、登入、編輯、AI 問答
   ▼                └─ 網頁編輯 → GitHub Contents API commit 回 my-note
Cloudflare KV ←─ 筆記原文 + 索引（清單/標籤/反向連結/搜尋）
Workers AI  ←─ 問資料庫（含 wiki/，需登入）
```

my-note repo 本身不需任何改動，只要在 GitHub 設定一個 webhook。

## 4. 資料流與儲存

### KV 結構

- `note:<path>`：單篇筆記原始 markdown（path 為 repo 相對路徑，如 `好工具推薦/opencode-mcp.md`）。
- `meta:index`：整體索引 JSON——檔案樹、每篇的標題/frontmatter/標籤/日期/摘要、wikilink 圖（含反向連結）、搜尋用資料。
- wiki/ 筆記同樣存 `note:<path>`，但索引標記 `private: true`，公開 API 一律過濾。

### API 路由

| 路由 | 方法 | 驗證 | 用途 |
|---|---|---|---|
| `/api/index` | GET | 公開 | 取得公開索引（檔案樹、標籤、backlinks、搜尋資料） |
| `/api/note/:path` | GET | 公開 | 取得白名單筆記原文；wiki/ 路徑回 404 |
| `/api/note/:path` | PUT | 登入 | 編輯儲存：GitHub Contents API commit → 同步 KV |
| `/api/login` | POST | — | 密碼換 session cookie |
| `/api/logout` | POST | — | 清 cookie |
| `/api/webhook` | POST | HMAC | GitHub push 事件：依 added/modified/removed 增量同步 KV + 重建索引 |
| `/api/sync` | POST | 登入 | 全量同步（首次部署後手動觸發一次） |
| `/api/ask` | POST | 登入 | AI 問答：檢索（含 wiki）→ Workers AI → 回答 |

### 編輯回寫流程

1. 前端 PUT 內容 + 該筆記目前的 blob SHA。
2. Worker 用 GitHub Contents API commit，message 格式：`docs: 網頁編輯「<標題>」`。
3. commit 成功後立即寫回 KV 並重建索引，畫面即時更新（不等 webhook）。
4. SHA 衝突（遠端已被改過）回 409，前端提示重新載入。

## 5. 前端頁面（依 Prototype.dc.html）

- **首頁**：分區筆記列表（依白名單資料夾分區）、排序切換（最近編輯/名稱）、搜尋入口。
- **文章頁**：右側固定目錄（TOC）、麵包屑、日期與標籤、編輯按鈕、儲存成功提示、反向連結卡片。
- **編輯模式**：Markdown textarea、儲存/取消、⌘S 儲存、Esc 取消、字元數狀態列。
- **標籤頁**：標籤 pill 列表 + 該標籤筆記卡片。
- **問資料庫頁**：範例問題、聊天氣泡（使用者右、AGENT 左）、狀態列（檢索中/已回覆）、未登入顯示登入提示。
- **搜尋 overlay**：⌘K 開啟、左結果列表右內容預覽、關鍵字 highlight、Esc 關閉。
- **側欄**：站名、搜尋框、資料夾樹（可折疊）、標籤/資料庫入口、迷你關聯圖（當前筆記鄰接節點）、亮暗切換、網址列。

### 渲染

- markdown-it 前端渲染：frontmatter、`[[wikilinks]]`（解析為站內連結；指向 wiki 或不存在頁面顯示失效樣式）、callout、表格、程式碼區塊＋複製按鈕。
- 字體：Noto Serif TC（標題）、Noto Sans TC（內文）、IBM Plex Mono（代碼）。
- 配色完全照原型 CSS 變數，含深色模式（`data-dark`）。
- 搜尋：後端索引、前端即時過濾（中文子字串比對）。

## 6. 登入與安全

- `SITE_PASSWORD`：登入密碼。
- `SESSION_SECRET`：session cookie HMAC 簽章金鑰。
- `WEBHOOK_SECRET`：GitHub webhook HMAC 驗證。
- `GITHUB_TOKEN`：fine-grained PAT，僅 hsjinde/my-note contents 讀寫權。
- 需登入：編輯、AI 問答、全量同步。閱讀完全公開。
- cookie：HttpOnly、Secure、SameSite=Lax、30 天。

## 7. AI 問答

- 檢索：對索引（含 wiki）做關鍵字比對評分，取前 N 篇（控制在模型 context 內）筆記全文。
- 呼叫 Workers AI LLM，system prompt 要求：繁體中文、僅根據資料庫內容回答、找不到就明說。
- 回覆逐則顯示於聊天串，狀態列顯示「檢索資料庫中…」→「已根據資料庫回覆」。

## 8. 測試與驗證

- Vitest 單元測試：索引建置、wikilink 解析、webhook 簽章驗證、session 簽發/驗證、白名單過濾。
- 本機 `wrangler dev` 全流程驗證。
- 部署後實測：push my-note → 網站更新；網頁編輯 → my-note 出現 commit；AI 問答正常。

## 9. 已知取捨

- `.canvas` 檔不渲染。
- 關聯圖為側欄迷你版（當前筆記鄰接節點），不做全頁互動圖。
- 中文搜尋用子字串比對，不做分詞。
- AI 檢索 v1 用關鍵字評分，不用向量庫；不夠準再升級 Vectorize。

## 10. 部署（使用者需提供/操作）

1. Cloudflare 帳號 account ID（使用者稍後提供）。
2. `wrangler deploy` + 設定 4 個 secrets。
3. GitHub my-note repo 新增 webhook（push 事件 → `/api/webhook`）。
4. 建立 fine-grained PAT。
5. 部署後登入網站按一次全量同步。
