---
name: my-note-web
description: 溫暖書卷氣的 Obsidian vault 公開閱讀網站——紙感、襯線標題、安靜的工具
colors:
  paper-warm: "#fbf7ef"
  panel-white: "#ffffff"
  ink-body: "#5a4f3e"
  ink-heading: "#3a3226"
  sand-muted: "#c2b39a"
  line-strong: "#e4d9c6"
  line-soft: "#f1ead9"
  bookmark-orange: "#c26b3e"
  bookmark-tint: "#c26b3e1a"
  amber-soft: "#d9a06b"
  code-block: "#f4eee1"
  code-inline: "#efe7d4"
  dark-paper: "#1c1917"
  dark-panel: "#262220"
  dark-ink: "#d9d2c7"
  dark-heading: "#f2ece1"
  dark-muted: "#8d8375"
  dark-line: "#38322d"
  dark-bookmark: "#ec9566"
typography:
  display:
    fontFamily: "'Noto Serif TC', serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.3
  headline:
    fontFamily: "'Noto Serif TC', serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "'Noto Serif TC', serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "'Noto Sans TC', system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 2.05
  label:
    fontFamily: "'Noto Sans TC', sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.12em"
  mono:
    fontFamily: "'IBM Plex Mono', monospace"
    fontSize: "12.5px"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "28px"
  xl: "44px"
components:
  button-primary:
    backgroundColor: "{colors.bookmark-orange}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 18px"
  button-secondary:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.md}"
    padding: "7px 16px"
  tag-chip:
    backgroundColor: "{colors.bookmark-tint}"
    textColor: "{colors.bookmark-orange}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  nav-item-active:
    backgroundColor: "{colors.bookmark-tint}"
    textColor: "{colors.bookmark-orange}"
    rounded: "{rounded.sm}"
    padding: "5px 8px"
  search-trigger:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.sand-muted}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: my-note-web

## 1. Overview

**Creative North Star: "書房紙頁（The Study Desk）"**

像在自己書房翻一本裝訂好的筆記：微暖的紙底、墨色的字、一枚橘色書籤。整個介面是「一張桌上的紙」——內容（筆記正文）永遠是視覺重心，工具（側邊欄、搜尋、編輯、AI 問答）像桌邊的文具，安靜地在場、伸手可及、不搶戲。行距與行長向「書」看齊而非 dashboard：內文行高 2.05，正文欄寬受限，留白慷慨。

這套系統明確拒絕 SaaS 行銷語彙——沒有漸層大標、沒有 hero 區塊、沒有卡片格陣——也拒絕文件站產生器的預設模板感。它的個性是溫暖、安靜、書卷氣；克制而精緻。

**Key Characteristics:**
- 暖紙色底 + 白色面板的兩層紙感，靠 1px 細線與色差分層，幾乎不用陰影
- 襯線（Noto Serif TC）標題 × 無襯線（Noto Sans TC）內文 × 等寬（IBM Plex Mono）後設資訊的三聲部
- 單一橘色（#c26b3e）作為唯一強調色，覆蓋率 ≤10%
- 亮暗雙主題同等公民，全部顏色走 CSS 變數（`--bg`、`--ac` 等，定義於 `src/app/theme.css`）
- 手機與桌機同等公民：任何浮層（抽屜、彈窗）必須有實心背景與 scrim

## 2. Colors

一張暖色的紙、一瓶墨水、一枚橘色書籤——低飽和大地色系，唯一的彩度留給書籤橘。

### Primary
- **書籤橘 Bookmark Orange** (#c26b3e / 暗色 #ec9566，token `--ac`)：唯一強調色。連結、作用中導覽項、主要按鈕、標籤文字。它的稀有是重點——出現就代表「可以互動」或「你在這裡」。
- **書籤橘暈 Bookmark Tint** (rgba(194,107,62,.10)，token `--ab`)：書籤橘的 10% 透明底，作用中項目與標籤的底色。
- **琥珀 Amber Soft** (#d9a06b / 暗色 #b06a42，token `--a2`)：書籤橘的副手——hover 連結、引用塊左緣、關聯圖次要節點。

### Neutral
- **暖紙 Paper Warm** (#fbf7ef / 暗色 #1c1917，token `--bg`)：頁面底色，桌上的那張紙。
- **面板白 Panel White** (#ffffff / 暗色 #262220，token `--pn`)：浮在紙上的第二層——搜尋框、TOC 卡、程式碼以外的面板。
- **墨色標題 Ink Heading** (#3a3226 / 暗色 #f2ece1，token `--hd`)：標題與需要最重的字。
- **墨色內文 Ink Body** (#5a4f3e / 暗色 #d9d2c7，token `--tx`)：正文。
- **沙色靜音 Sand Muted** (#c2b39a / 暗色 #8d8375，token `--mu`)：日期、路徑、標籤 kicker 等後設資訊。**只准用於輔助資訊，不准用於需要閱讀的正文**——它在暖紙上的對比故意低。
- **實線 / 虛線 Line Strong / Soft** (#e4d9c6 / #f1ead9，token `--ln` / `--ls`)：分隔一切的 1px 細線；Strong 用於邊框，Soft 用於列表列分隔。
- **碼塊 / 行內碼底 Code Block / Inline** (#f4eee1 / #efe7d4，token `--cb` / `--ci`)。

### Named Rules
**書籤規則（The Bookmark Rule）。** 書籤橘在任何畫面的覆蓋率 ≤10%。它只標記「可互動」與「目前位置」，永不作裝飾。
**變數優先規則（The Token Rule）。** 任何新顏色一律先問「哪個現有變數可以用」；直接寫死 hex 是禁止的，新增變數需同時提供亮暗兩版。

## 3. Typography

**Display Font:** Noto Serif TC（fallback: serif）
**Body Font:** Noto Sans TC（fallback: system-ui, sans-serif）
**Label/Mono Font:** IBM Plex Mono（fallback: monospace）

**Character:** 襯線標題給出「書」的重量，無襯線內文保持長篇中文的可讀性，等寬字專職日期、路徑、標籤、快捷鍵——三種字各司其職，畫面不用顏色也有層次。

### Hierarchy
- **Display**（700, 40px, 1.3）：首頁站名，僅此一處。
- **Headline**（700, 34px/1.3）：文章頁 H1。
- **Title**（600, 24px，帶 1px 底線）：文章內 H2；H3 為 600, 18px 無底線。
- **Body**（400, 15.5px, 行高 2.05）：筆記正文。行寬受版面 max-width 限制（首頁 900px、文章欄約 65–75ch）。
- **Label**（500, 11px, 字距 0.12em）：區塊 kicker（「總覽」「目錄」「排序」）。搭配 `--mu` 沙色。
- **Mono**（400, 11–13.5px）：日期、路徑、標籤、字數、快捷鍵提示。

### Named Rules
**三聲部規則（The Three Voices Rule）。** 襯線只給標題、無襯線只給正文與 UI、等寬只給後設資訊。三者不得互換角色；正文永不使用襯線或等寬。

## 4. Elevation

以「紙的層疊」表達深度，不以陰影：底紙（`--bg`）→ 面板（`--pn`）→ 1px 細線（`--ln`）圈出邊界。表面在靜止時是平的。陰影只保留給真正「浮起來」的東西——固定 TOC 卡的極淡環境影（`0 4px 14px rgba(58,50,38,.06)`）、行動版側欄抽屜（`8px 0 24px rgba(0,0,0,.2)`）、登入彈窗（`0 24px 60px rgba(26,20,12,.35)`）。

### Shadow Vocabulary
- **ambient-card**（`box-shadow: 0 4px 14px rgba(58,50,38,.06)`）：固定側浮面板（TOC）專用的極淡影。
- **drawer**（`box-shadow: 8px 0 24px rgba(0,0,0,.2)`）：行動版抽屜滑出時的單側投影。
- **modal**（`box-shadow: 0 24px 60px rgba(26,20,12,.35)`）：彈窗層級，搭配 scrim。

### Named Rules
**平面優先規則（The Flat Paper Rule）。** 靜止的表面用色差與細線分層，不用陰影。陰影只授予「懸浮在頁面之上」的三種東西：固定浮卡、抽屜、彈窗。邊框與寬陰影不得同時作為裝飾出現在同一元素上。

## 5. Components

整體性格：**克制而精緻**——細邊框、平面為主，hover 時才輕輕回應。

### Buttons
- **Shape:** 輕微圓角（8px）
- **Primary:**「儲存」「登入」等唯一主行動——書籤橘底（#c26b3e）白字，padding 8px 18px，無邊框無陰影
- **Secondary:**「取消」「編輯」——面板白底 + 1px `--ln` 邊框，墨色字，padding 7px 16px
- **Hover / Focus:** 顏色微移（`--ac` → `--a2`），不位移、不放大

### Chips（標籤 / 狀態徽章）
- **Style:** 等寬字 12.5px、書籤橘字色、書籤橘暈底、全圓角 pill（radius 12–999px）、padding 2px 10px
- **State:** 標籤永遠可點導向標籤頁；「編輯中」徽章同樣式作狀態指示

### Cards / Containers
- **Corner Style:** 10–14px（TOC 卡 10px、登入彈窗 14px；上限 16px）
- **Background:** `--pn` 面板白
- **Shadow Strategy:** 依 Elevation 的平面優先規則——靜止卡片只有 1px `--ln` 邊框
- **Internal Padding:** 16–28px

### Inputs / Fields
- **Style:** 1px `--ln` 邊框、`--pn` 底、8px 圓角、padding 8–12px；編輯器 textarea 為無邊框全幅、等寬 14px/2
- **Focus:** `outline: none` 搭配邊框色加深（實作時補上可見的 focus 樣式，至少邊框轉 `--ac`）
- **Placeholder:** 使用 `--mu`，僅限提示性文字

### Navigation（側邊欄）
- 13.5px 無襯線；資料夾樹用 ▸/▾ 展開符與 1px 左緣線縮排；作用中項目：書籤橘暈底 + 書籤橘字 + 500 字重，圓角 6px
- 行動版：固定抽屜 `width: min(280px, 82vw)`，**必須有實心 `--bg` 背景**、drawer 陰影與 scrim（rgba(20,16,10,.35)），滑入 0.25s ease 並尊重 `prefers-reduced-motion`

### 關聯圖（Signature Component）
側邊欄底部的迷你 wikilink 星圖：中心節點書籤橘、鄰居節點沙色/琥珀、1px `--ln` 連線，裝在面板白圓角卡裡。是「連結是導覽的靈魂」原則的視覺註腳。

## 6. Do's and Don'ts

### Do:
- **Do** 所有顏色走 `theme.css` 的 CSS 變數，新增顏色必須同時給亮暗兩版。
- **Do** 讓書籤橘保持稀有（≤10% 覆蓋率），它只標記互動與目前位置。
- **Do** 用 1px 細線與紙的層疊（`--bg` → `--pn`）分層，靜止表面保持平面。
- **Do** 任何固定定位的浮層（抽屜、彈窗、浮卡）都給實心背景 + 對應層級的陰影 + scrim。
- **Do** 每個新介面先在 375px 寬的手機視窗驗證過再算完成；觸控目標 ≥44px。
- **Do** 動畫尊重 `prefers-reduced-motion: reduce`，一律提供瞬間切換的替代。

### Don't:
- **Don't** 做出「SaaS 行銷風」——漸層大標、hero 區塊、卡片格陣、行銷式 CTA（PRODUCT.md 反面參考，原話照抄）。
- **Don't** 長成 Quartz／Docusaurus 預設模板的樣子。
- **Don't** 用 `--mu` 沙色排需要閱讀的正文——它是後設資訊專用色，對比故意低。
- **Don't** 在同一元素上同時使用 1px 邊框與寬柔陰影作裝飾。
- **Don't** 寫死 hex 顏色繞過變數系統，或只改亮色忘了暗色。
- **Don't** 用 `border-left` 超過 1px 的色條當強調（引用塊的 3px `--a2` 左緣是唯一既有例外，不再新增）。
- **Don't** 讓正文使用襯線或等寬字——三聲部各司其職。
