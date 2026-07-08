# my-note-web

Obsidian vault（hsjinde/my-note）的公開閱讀網站：React + Vite SPA + Cloudflare Worker（Hono）+ KV + Workers AI。架構與開發流程見 [README.md](README.md)。

## Design Context

任何涉及 UI 的變更，先讀這兩份：

- [PRODUCT.md](PRODUCT.md) — 定位（product register）、讀者、品牌個性（溫暖、安靜、書卷氣）、反面參考（拒絕 SaaS 行銷風）、五條設計原則。
- [DESIGN.md](DESIGN.md) — 視覺系統「書房紙頁」：色彩 token（`src/app/theme.css` 的 CSS 變數為唯一來源，亮暗雙版）、三聲部字型（Noto Serif TC 標題／Noto Sans TC 內文／IBM Plex Mono 後設資訊）、平面優先的層級策略、元件規格與 Do/Don't。

速記三條硬規則：顏色一律走 CSS 變數且亮暗都要給；書籤橘（`--ac`）覆蓋率 ≤10%；新介面要在 375px 手機視窗驗證過才算完成。
