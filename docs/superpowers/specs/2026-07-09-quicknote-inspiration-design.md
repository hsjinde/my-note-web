# 臨時靈感區設計

## 目標

在網站左側側欄新增一塊「靈感」區,讓使用者隨手記錄臨時靈感。靈感會寫回 GitHub `hsjinde/my-note` vault,並在網站上公開顯示。

## 範圍

- Vault 新增一個與 `個人學習/`、`好工具推薦/`、`工作專案/` 同級的資料夾 `靈感/`,加入公開白名單。
- 資料夾內單一 append 檔 `靈感/隨手靈感.md`,每則靈感一行。
- 側欄新增「靈感」區:輸入框 + 送出按鈕 + 最近 5 則列表。
- 新增後端端點 `POST /api/quicknote` 處理 append 寫回。

不在範圍內:編輯/刪除既有靈感(靈感檔仍可透過既有文章編輯頁全文編輯)、多檔一則、私密 inbox。

## Vault 結構

- 新資料夾:`靈感/`,與現有三個公開資料夾同級。
- 加入 `src/worker/content.ts` 的 `PUBLIC_FOLDERS`(公開、可讀、可寫回)。
- 單一檔:`靈感/隨手靈感.md`
  - 檔案不存在時新建,含 frontmatter:
    ```
    ---
    title: 隨手靈感
    ---

    # 隨手靈感

    ```
  - 每則靈感 append 一行:`- [YYYY-MM-DD HH:mm] 內容`
  - 時間戳為台灣時間(UTC+8)。

## 後端:`POST /api/quicknote`

- 需登入(`requireAuth`)。
- Request body:`{ text: string }`;`text` 去除前後空白後為空 → 回 400。
- 流程(read-modify-write,GitHub 為真實來源):
  1. `github.getFile('靈感/隨手靈感.md')` 取最新內容 + sha(可能為 null)。
  2. null → 用新建範本 + 第一則;否則在結尾 append 新行。
  3. 換行處理:確保新行前恰好一個換行,結尾保留一個換行。
  4. `github.putFile(path, content, 'docs: 靈感', sha?)` commit。
  5. 更新 KV shard(`shardKey(path)`)寫入 `{ content, sha }`,再 `rebuildIndexFromKV(NOTES)`。
  6. 回傳 `{ recent: string[] }`——解析後最近 5 則(新的在前),供前端即時刷新。
- 錯誤:`ShaConflictError` → 409(前端提示稍後再試);其餘 throw。

### 靈感行解析

- 從檔案 body 取所有符合 `- [時間] 內容` 的行。
- 「最近 5 則」= 檔案中最後 5 行,反轉為新的在前。
- 解析函式應同時給後端 `/api/quicknote` 回傳與前端顯示使用(可放 `src/shared` 或前端各自解析;實作時擇一,避免重複邏輯)。

## 前端:側欄靈感區(`src/app/components/Sidebar.tsx`)

位置:放在「資料庫」項目下方,「關聯圖 / 深色切換」之上。

元件內容:
- 區塊標題「靈感」(沿用現有 `label` 樣式)。
- 多行輸入框(`textarea`),placeholder 如「記下一個靈感…」。
- 送出:「記下來」按鈕,或在輸入框按 `⌘/Ctrl + Enter`。
- 送出行為:
  - 未登入 → 呼叫 `requireLogin(then)`,登入後續送。
  - 送出中禁用按鈕;成功後清空輸入框、刷新最近列表、顯示短暫「已記下」提示;失敗顯示錯誤。
- 最近 5 則列表:
  - 每則顯示內容(時間戳可弱化顯示或省略),點擊跳至 `#/note/靈感/隨手靈感.md`。
  - 初始資料來源:載入時 `GET /api/note/靈感/隨手靈感.md`(公開、免登入)解析;送出成功後以回傳的 `recent` 更新。
  - 檔案不存在(404)→ 顯示空狀態(例如「還沒有靈感」)。

### 需要傳入 Sidebar 的 props

- `authed: boolean` 與 `requireLogin: (then: () => void) => void`(目前 `App.tsx` 有,但未傳給 Sidebar,需補上)。
- `onQuicknoteSaved?: () => void`:送出成功後觸發 `reloadIndex`,讓側欄樹也反映新檔(首次新建時)。

## API 客戶端(`src/app/api.ts`)

新增 `postQuicknote(text: string): Promise<{ recent: string[] }>` 與(若需要)`fetchNote(path)` 或沿用既有讀取函式。

## 資料流總覽

```
使用者在側欄輸入靈感 → POST /api/quicknote { text }
  → Worker getFile(靈感/隨手靈感.md) → append → putFile commit
  → 更新 KV shard + rebuildIndexFromKV
  → 回傳 recent[]
  → 側欄刷新最近列表;onQuicknoteSaved → reloadIndex 更新側欄樹
GitHub webhook（既有）→ incrementalSync 也會同步此檔（跨裝置一致）
```

## 錯誤處理

- 空白文字 → 前端擋下(不送出)。
- 未登入 → 登入彈窗。
- 409 sha 衝突 → 提示「儲存衝突,請再試一次」。
- 網路/其他錯誤 → 通用錯誤提示,輸入框內容保留。

## 測試

- `content.ts`:`isPublicPath('靈感/隨手靈感.md')` 為 true;`isPublicPath` 對非白名單仍 false。
- 靈感行解析:空檔、單則、超過 5 則(取最後 5、順序反轉)。
- append 邏輯:新建範本正確;既有檔尾端換行處理正確(不產生多餘空行)。
- `POST /api/quicknote`:空 text → 400;成功回傳 recent。
- 手動/整合:未登入送出跳登入;送出後 GitHub 出現 `docs: 靈感` commit;側欄樹出現「隨手靈感」。
```
