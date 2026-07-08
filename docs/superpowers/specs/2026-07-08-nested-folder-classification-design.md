# 資料夾巢狀分類 設計規格

- 日期：2026-07-08
- 狀態：已確認
- 背景：原始 Obsidian vault 在頂層資料夾（如「個人學習」）底下還有子資料夾分類（如 LeetCode、Obsidian筆記、多益）。目前網站的 `NoteMeta.folder` 只取路徑第一層，導致這些子分類被打平，混在同一層清單裡。本規格讓網站的分類結構比照原始 vault 的資料夾樹。

## 1. 目標

- Sidebar、首頁、搜尋結果、文章麵包屑都要能反映筆記在 vault 中的完整資料夾路徑（支援任意深度）。
- 不新增任何篩選/導覽用的資料夾頁面，維持目前的路由範圍。

## 2. 資料模型

`src/worker/content.ts` 的 `parseNote`：

- `folder` 欄位語意從「路徑第一層」改為「完整資料夾路徑（不含檔名）」。
  - `個人學習/LeetCode/兩數之和.md` → `folder = '個人學習/LeetCode'`
  - `好工具推薦/opencode-mcp.md` → `folder = '好工具推薦'`（無子資料夾時行為不變）
- 實作：`folder: path.split('/').slice(0, -1).join('/')`
- `src/shared/types.ts` 的 `NoteMeta.folder` 註解同步更新為「完整資料夾路徑（不含檔名）」。
- 不新增欄位，任意深度都靠這個字串以 `/` 分段支撐。

## 3. 共用資料夾樹工具

新檔案 `src/app/folderTree.ts`：

```ts
export interface FolderNode {
  name: string;       // 該層資料夾名稱
  fullPath: string;   // 該層完整路徑（用來當展開狀態的 key）
  notes: NoteMeta[];  // 直接位於此資料夾（非子資料夾）的筆記
  children: FolderNode[]; // 子資料夾，依 zh-Hant 排序
}

export function buildFolderTree(notes: NoteMeta[]): FolderNode[];
```

- 依 `note.folder` 用 `/` 切分，逐層建立/查找節點，最後把筆記掛在對應層的 `notes`。
- 每一層的 `children` 依資料夾名稱 `localeCompare(b, 'zh-Hant')` 排序；`notes` 排序邏輯維持由呼叫端（Sidebar / Home）決定，不在這裡排序。
- 只處理巢狀分組，不做篩選、不做筆數快取（呼叫端要顯示筆數時用 `notes.length` + 遞迴加總 children）。

Sidebar 和 Home 都改為呼叫這個共用函式，移除各自手刻的第一層分組邏輯。

## 4. Sidebar

- 展開狀態 `open: Record<string, boolean>` 的 key 從資料夾名稱改為 `fullPath`（如 `個人學習`、`個人學習/LeetCode` 各自獨立）。
- 遞迴渲染 `FolderNode`：資料夾列（▸/▾ + 名稱）→ 展開時先列子資料夾（遞迴），再列直屬筆記。
- 子層縮排 + 左側引導線沿用現有樣式，遞迴時縮排量疊加。

## 5. 首頁（Home）

- 頂層（`buildFolderTree` 回傳的第一層節點）維持現有大標題樣式 + 總筆數（`notes.length` + 所有子孫 `notes.length` 總和）。
- 有子資料夾時，子資料夾渲染為次級標題（字級小一階，同樣顯示該子資料夾累計筆數），標題下方才是該子資料夾直屬的筆記列表；若有更深層，遞迴套用相同的「次級標題」樣式（樣式不再分階，深層一律用同一種次級標題，避免視覺層級爆炸）。
- 資料夾本身固定依 `buildFolderTree` 給的字母序排列；「最近編輯／名稱」排序切換只套用在每層的直屬筆記列表上（現有行為，範圍不變）。

## 6. 麵包屑與搜尋結果

- `src/app/pages/Article.tsx` 的麵包屑：`{meta?.folder}` 這段改成把完整路徑用 ` / ` 分隔渲染成多個文字節點（純顯示，不做連結、不新增路由）。
- `src/app/components/SearchOverlay.tsx` 顯示 `n.folder` 的地方不用改程式碼，資料本身變成完整路徑後會自動顯示正確內容。

## 7. 測試

- `tests/content.test.ts`：新增巢狀路徑案例，驗證 `parseNote('個人學習/LeetCode/a.md', ...).folder === '個人學習/LeetCode'`；既有「好工具推薦」頂層案例維持不變。
- 新增 `tests/folderTree.test.ts`：
  - 巢狀路徑正確分組（多層）
  - 同層資料夾依 zh-Hant 排序
  - 直屬筆記正確掛在對應節點的 `notes`

## 8. 不做的事（明確排除）

- 不新增「依資料夾篩選」頁面或路由。
- 不讓麵包屑可點擊跳轉。
- 不改變 `PUBLIC_FOLDERS` / `AI_EXTRA_FOLDERS` 白名單邏輯（`src/worker/content.ts` 的 `inFolders` 判斷式不受影響，因為它本來就是用完整路徑 `startsWith` 判斷，不依賴 `folder` 欄位）。
