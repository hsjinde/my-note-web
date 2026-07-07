---
title: my-note 閱讀網站建置規格（Quartz 4）
tags: [工作專案, Quartz, Obsidian, 網站, GitHub-Pages]
date: 2026-07-07
updated: 2026-07-07
status: 規劃中
---

# my-note 閱讀網站建置規格（Quartz 4）

把本 Obsidian vault 的部分筆記，用 **Quartz 4** 產生成公開閱讀網站，部署到 GitHub Pages。

## 1. 目標
- 把學習筆記與作品集做成好讀、可公開分享的網站。
- 提供全文搜尋、反向連結、亮/暗切換的閱讀體驗。
- `wiki/` 等私人區塊不出現在網站上（但 repo 維持 public）。

## 2. 決策摘要
| 項目 | 決定 |
|---|---|
| 用途 | 公開網站，分享給他人閱讀 |
| 建站工具 | Quartz 4（專為發布 Obsidian vault 的靜態網站產生器）|
| 部署 | GitHub Pages（同一個 public repo）+ GitHub Actions 自動 build |
| 網址 | `https://hsjinde.github.io/my-note/` |
| 公開範圍 | `個人學習/`、`好工具推薦/`、`工作專案/`（白名單）|
| 排除 | `wiki/`、`日常/`、`Clippings/`（不上網站）|
| 風格 | 簡約文件風（白底、無襯線、藍點綴、大留白）；Quartz 內建亮/暗切換 |
| Repo 可見性 | 維持 public（wiki 等被看到沒差，只是不上網站）|

## 3. 架構
Quartz 放在 repo 子資料夾 `website/`。Build 時只把白名單資料夾複製進 `website/content/`，由 Quartz 產生靜態頁到 `website/public/`，最後由 Actions 部署到 Pages。

內容流：

```
Obsidian vault (public repo)
  ├── 個人學習/     ┐
  ├── 好工具推薦/   ├─(Action 白名單複製)→ website/content/ ─(quartz build)→ website/public/ ─(deploy)→ GitHub Pages
  └── 工作專案/     ┘
  ├── wiki/ 日常/ Clippings/   ✗ 不進網站（仍留在 repo）
```

> 採白名單（allowlist）而非黑名單：**只有明列的 3 個資料夾會上網站**，日後新增私人資料夾不會誤外流。

## 4. 閱讀功能（Quartz 內建）
左側資料夾樹總管、全文搜尋（支援中文）、反向連結 backlinks、關聯圖 graph、標籤頁、目錄 TOC、亮/暗切換。原生支援 `[[wikilinks]]`、`[!callout]`、frontmatter（title / tags / date）。

## 5. 風格：簡約文件風
- 白/淺灰底、無襯線字（Noto Sans TC）、藍色點綴、大量留白。
- 長技術筆記可讀性最高，對公開受眾最安全。
- Quartz 內建亮/暗模式切換，讀者可自行切換。
- 備選：技術深色風 / 溫暖知識花園——改一處 config 即可切換。

## 6. 已知取捨
- **跨到 wiki 的 wikilink 會斷**：學習筆記若 `[[Andrej-Karpathy]]` 指向 `wiki/entities`（不上站），會顯示為無效連結。可接受；日後可選擇性補上被連到的頁。
- **`.canvas` 不渲染**：如 `SRE 學習路徑圖.canvas`，Quartz 原生不支援，v1 先略過。

## 7. 隱私與安全
- Repo 維持 public；`wiki/`、`日常/`、`Clippings/` 不進網站，但原始碼仍公開（使用者已確認可接受）。
- 敏感掃描（`工作專案/`）結果：`API_KEY` 等皆為文件佔位符（`<你的 API Key>`），非真實金鑰；`KeyLogger-Server` 為附免責聲明、已公開於 GitHub 的作品集。→ 可發布。
- 上線前建議本機預覽再肉眼確認一次。

## 8. 會動到的檔案
- 新增 `website/`：Quartz 框架 + `quartz.config.ts`（baseUrl=`hsjinde.github.io/my-note`、站名、語言 zh-TW、主題色）。
- 新增 `.github/workflows/deploy.yml`：白名單複製 → `npx quartz build` → 部署 Pages。
- 更新 `.gitignore`：忽略 `website/content/`、`website/public/`、`website/node_modules/`。
- 不改任何既有筆記；不改 repo 可見性。

## 9. 部署步驟
1. 初始化 Quartz 於 `website/`。
2. 設定 `quartz.config.ts`（baseUrl、風格、語言）。
3. 建立 Actions workflow（複製白名單 → build → deploy）。
4. GitHub repo Settings → Pages → Source 選「GitHub Actions」（一次性設定）。
5. Push → Actions 綠燈 → 開網址確認。

## 10. 驗證
- 本機 `npx quartz build --serve` 預覽 → 確認 3 個資料夾內容、中文搜尋、連結、亮/暗切換正常。
- 部署後開 `https://hsjinde.github.io/my-note/` 確認。

## 11. 下一步
- 使用者確認本 spec 與風格 → 產出實作計畫（writing-plans）→ 實作。
