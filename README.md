# my-note-web

把 [hsjinde/my-note](https://github.com/hsjinde/my-note)（Obsidian vault）做成公開閱讀網站，並支援：

1. **推送自動更新**：my-note 推送後網站幾秒內反映新內容（GitHub webhook → KV 增量同步）。
2. **網頁編輯回寫**：在網頁上編輯筆記，自動 commit 回 hsjinde/my-note。
3. **AI 問答（問資料庫）**：透過 Cloudflare Workers AI，根據筆記內容（含 `wiki/`）回答問題。

## 架構

單一 Cloudflare Worker（Hono）同時服務 React SPA 靜態資產與 `/api/*`：

```
hsjinde/my-note (GitHub)
   │  push → GitHub webhook（幾秒內）
   ▼
Cloudflare Worker ──── 靜態前端（SPA，React + Vite）
   │                ├─ /api/*：內容、搜尋索引、登入、編輯、AI 問答
   ▼                └─ 網頁編輯 → GitHub Contents API commit 回 my-note
Cloudflare KV ←─ 筆記原文 + 索引（清單/標籤/反向連結/搜尋）
Workers AI  ←─ 問資料庫（含 wiki/，需登入）
```

公開閱讀白名單：`個人學習/`、`好工具推薦/`、`工作專案/`。AI 問答額外索引 `wiki/`，但 wiki 內容永不出現在公開頁面與公開 API。

詳細設計見 [docs/superpowers/specs/2026-07-08-my-note-web-design.md](docs/superpowers/specs/2026-07-08-my-note-web-design.md)，實作計畫見 [docs/superpowers/plans/2026-07-08-my-note-web.md](docs/superpowers/plans/2026-07-08-my-note-web.md)。

## 本機開發

需求：Node.js（本專案的 vite/vitest 已鎖定為相容 Node 20 的版本；若你的機器是 Node 22+，也可以照原計畫升級到最新的 vite/vitest/wrangler）。

```bash
npm install
```

在專案根目錄建立 `.dev.vars`（已列入 `.gitignore`，不會被 commit）：

```
SITE_PASSWORD=devpw
SESSION_SECRET=devsecret
WEBHOOK_SECRET=devwh
GITHUB_TOKEN=<你的 GitHub fine-grained PAT，留空只能測公開閱讀>
```

開兩個終端：

```bash
npx wrangler dev        # 啟動 Worker（API + KV 模擬），預設 http://127.0.0.1:8787
npm run dev              # 啟動前端（Vite），http://localhost:5173，/api 會 proxy 到上面的 Worker
```

用瀏覽器開 `http://localhost:5173` 即可看到網站。若本機 8787 port 被其他程式占用，改用 `npx wrangler dev --port <其他 port>` 並同步修改 [vite.config.ts](vite.config.ts) 的 proxy 目標。

跑測試與型別檢查：

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

### 首次同步

尚未同步過任何筆記時，`/api/index` 會回空清單。登入後在瀏覽器 DevTools console 呼叫：

```js
fetch('/api/sync', { method: 'POST' }).then(r => r.json()).then(console.log)
```

會從 GitHub 抓白名單 + `wiki/` 的全部 `.md` 檔寫入 KV，之後首頁就會出現筆記。

> 注意：Workers AI 綁定即使在本機 `wrangler dev` 也會連到你真實的 Cloudflare 帳號並計費（`ask()` 在資料庫沒有內容時會提早回覆，不會呼叫 AI；但一旦同步過筆記，本機測試「問資料庫」就會產生真實用量）。

## 部署

1. 建立 KV namespace，並把回傳的 id 填入 [wrangler.jsonc](wrangler.jsonc) 的 `kv_namespaces[0].id`：

   ```bash
   npx wrangler kv namespace create NOTES
   ```

2. 設定四個 secrets（依序執行，會提示輸入值）：

   ```bash
   npx wrangler secret put SITE_PASSWORD
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put WEBHOOK_SECRET
   npx wrangler secret put GITHUB_TOKEN
   ```

3. 部署：

   ```bash
   npm run deploy
   ```

4. 到 GitHub `hsjinde/my-note` → Settings → Webhooks → Add webhook：
   - Payload URL：`https://<你的 worker 網址>/api/webhook`
   - Content type：`application/json`
   - Secret：與 `WEBHOOK_SECRET` 相同
   - 只勾選 `push` 事件

5. 建立 GitHub fine-grained PAT（Settings → Developer settings → Fine-grained tokens）：
   - Repository access：只選 `hsjinde/my-note`
   - Permissions：Contents → Read and write

6. 開網站 → 登入 → 依上方「首次同步」步驟執行一次 `/api/sync`。

## 驗收清單

- [ ] push my-note 後幾秒內首頁出現新筆記
- [ ] 網頁編輯並儲存後，my-note 出現 `docs: 網頁編輯「…」` 的 commit
- [ ] 「問資料庫」能根據筆記內容回答（含只在 `wiki/` 裡的內容）
- [ ] 未登入時編輯按鈕與問資料庫都會跳出登入提示，讀取頁面完全公開
