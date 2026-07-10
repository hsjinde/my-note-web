# 新增筆記設計

## 目標

讓站主在網站上從無到有建立一篇新的 `.md` 筆記，commit 回 `hsjinde/my-note`，建立後直接進入該篇的編輯畫面撰寫內容。補齊目前只能「編輯既有筆記」與「append 靈感」的缺口。

## 範圍

- 側欄新增「＋ 新增筆記」入口（需登入）。
- 彈窗：選公開資料夾 ＋ 填標題，即時預覽路徑，處理錯誤。
- 新增後端端點 `POST /api/note` 建立空白筆記（只有 `title` frontmatter）。
- 建立成功後導入該篇文章頁並自動進入編輯模式。

不在範圍內：自訂完整路徑／建立新子資料夾（僅限現有公開資料夾）、範本挑選、批次建立、刪除筆記。

## 存放規則

- 資料夾：從 `src/worker/content.ts` 的 `PUBLIC_FOLDERS`（`個人學習`／`好工具推薦`／`工作專案`／`靈感`）擇一。
- 檔名：`<標題>.md`；路徑 `<資料夾>/<標題>.md`。
- 初始內容（只有 title frontmatter）：
  ```
  ---
  title: <標題>
  ---

  ```
  （frontmatter 後保留一個空行，供編輯時直接接內文。）

## 後端：`POST /api/note`

- 需登入（`requireAuth`）。
- Request body：`{ folder: string; title: string }`。
- 流程：
  1. `title` 去除前後空白；為空 → 回 400（`empty title`）。
  2. 標題含檔名非法字元 `/ \ : * ? " < > |` → 回 400（`invalid title`）。
  3. 組 `path = folder + '/' + title + '.md'`；`isPublicPath(path)` 為 false（資料夾不在白名單或非 `.md`）→ 回 400（`invalid path`）。
  4. 檢查是否已存在：先查 KV shard（`shardKey(path)`）；保險起見再 `github.getFile(path)`。任一存在 → 回 **409**（`already exists`）。
  5. `github.putFile(path, content, 'docs: 新增「<標題>」')`（不帶 sha，建立新檔）。
  6. 更新 KV shard 寫入 `{ content, sha }`，再 `rebuildIndexFromKV(NOTES)`。
  7. 回傳 `{ path, sha }`。
- 錯誤：`putFile` 對已存在檔案會回 422 → `ShaConflictError` → 也映射為 409（雙重保險，避免步驟 4 與 GitHub 之間的競態覆寫）；其餘 throw。

## 前端：側欄入口（`src/app/components/Sidebar.tsx`）

- 位置：「總覽」樹上方或「資料庫」下方，一顆低調的「＋ 新增筆記」按鈕。
- 樣式：邊框式按鈕（`border: 1px solid var(--ln)` + `var(--pn)` 底），**不用**橘底，維持 `--ac` 覆蓋率 ≤10%。
- 行為：`onClick` → `requireLogin(() => onNewNote())`（未登入先跳登入）。
- 新增 prop：`onNewNote: () => void`（觸發 App 層開彈窗）。

## 前端：新增彈窗（`src/app/App.tsx`）

彈窗狀態與元件放在 **App.tsx**，與登入 modal 同層（app-shell 級覆蓋層），沿用其視覺（`role="dialog"` + scrim + 點外／Esc 關閉）。

內容：
- 資料夾下拉（`select`）：選項來自 `PUBLIC_FOLDERS`（前端可從 `content.ts` 匯出或另置 `src/shared`；實作時擇一，避免白名單重複定義）。
- 標題輸入（`input`，`autoFocus`），Enter 送出。
- 路徑預覽：`<資料夾>/<標題>.md`，灰字 `IBM Plex Mono`。
- 錯誤區：
  - 標題空白 → 前端擋下（送出鈕 disable 或不送）。
  - 非法字元 → 「標題不能包含 / \ : * ? " < > |」。
  - 409 → 「這篇筆記已經存在」。
  - 其他 → 通用錯誤，輸入內容保留。
- 建立中 disable 送出鈕。

建立成功：`postNote(folder, title)` → 拿到 `{ path }` → `reloadIndex()`（新筆記進側欄樹）→ `location.hash = '#/note/' + encodeURIComponent(path) + '?edit=1'` → 關窗、清空輸入。

## 前端：自動進入編輯（`src/app/pages/Article.tsx`）

- `router.ts` 已把 `?...` 從 path 切掉，`#/note/<path>?edit=1` 仍解析為正常 article route，不需改 router。
- `Article.tsx` 新增 effect：note 載入完成後，若 `location.hash` 帶 `edit=1` 則自動呼叫 `startEdit()`（此時已登入，`requireLogin` 直接放行），並用 `history.replaceState` 移除 `?edit=1`，避免重整／返回時重複觸發。

## API 客戶端（`src/app/api.ts`）

新增：

```ts
export const postNote = (folder: string, title: string) =>
  fetch('/api/note', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, title }),
  }).then((r) => json<{ path: string; sha: string }>(r));
```

沿用現有 `json()` 的錯誤映射（401→`unauthorized`、409→`conflict`）。

## 資料流總覽

```
側欄「＋ 新增筆記」→ requireLogin → App 彈窗（選資料夾＋填標題）
  → POST /api/note { folder, title }
    → Worker 驗證 + 檢查不存在 → putFile 建立空白筆記（title frontmatter）
    → 更新 KV shard + rebuildIndexFromKV → 回傳 { path, sha }
  → reloadIndex（側欄樹出現新筆記）
  → 導頁 #/note/<path>?edit=1 → Article 自動進編輯
GitHub webhook（既有）→ incrementalSync 也會同步此檔（跨裝置一致）
```

## 錯誤處理

- 標題空白 → 前端擋下。
- 非法字元 → 前端／後端各擋一次，提示明確字元清單。
- 未登入 → 登入彈窗。
- 409 同名 → 「這篇筆記已經存在」，不覆寫。
- 網路／其他錯誤 → 通用提示，輸入內容保留。

## 測試（`tests/create-note.test.ts`）

沿用既有測試對 GitHub 的 mock 風格：

- 空白標題 → 400。
- 含非法字元標題 → 400。
- 非白名單資料夾（如 `wiki/x`）→ 400。
- 目標已存在 → 409（KV 已有 或 GitHub 回既有檔）。
- 成功建立：回傳 `{ path, sha }`；KV shard 含該筆記且內容為 title frontmatter 範本；`meta:index` 含該筆記。
- 手動／整合：未登入點「新增筆記」跳登入；建立後 GitHub 出現 `docs: 新增「…」` commit；側欄樹出現新筆記並自動進入編輯畫面；375px 手機視窗驗證彈窗與按鈕。
