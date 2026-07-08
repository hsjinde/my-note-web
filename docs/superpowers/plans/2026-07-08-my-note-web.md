# my-note-web 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建置 Cloudflare Worker 筆記網站：公開閱讀 hsjinde/my-note、webhook 即時同步、網頁編輯回寫 commit、Workers AI 問答。

**Architecture:** 單一 Cloudflare Worker（Hono）同時服務 React SPA 靜態資產與 `/api/*`；筆記原文與索引存 KV，由 GitHub webhook 增量同步；編輯用 GitHub Contents API commit 回 my-note；AI 問答用 Worker 原生 AI binding。

**Tech Stack:** TypeScript、Hono、React 18 + Vite、markdown-it、yaml、Vitest、wrangler。

**Spec:** `docs/superpowers/specs/2026-07-08-my-note-web-design.md`
**設計稿（UI 以此為準）:** `Quartz 閱讀網站建置規格-handoff/quartz/project/Prototype.dc.html`

## Global Constraints

- 來源 repo：`hsjinde/my-note`，分支 `main`。
- 公開白名單資料夾：`個人學習/`、`好工具推薦/`、`工作專案/`；AI 額外索引 `wiki/`。
- wiki/ 內容**永不**出現在公開頁面與公開 API（`/api/index`、`/api/note` GET 一律過濾）。
- 只索引 `.md` 檔。
- 需登入的 API：`PUT /api/note/*`、`POST /api/sync`、`POST /api/ask`。
- Session cookie：HttpOnly、Secure、SameSite=Lax、Max-Age 2592000（30 天）。
- 編輯 commit message 格式：`docs: 網頁編輯「<標題>」`。
- Secrets（wrangler secret）：`SITE_PASSWORD`、`SESSION_SECRET`、`WEBHOOK_SECRET`、`GITHUB_TOKEN`。
- AI 模型（vars.AI_MODEL 可換）：預設 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`；回覆繁體中文、僅根據資料庫內容。
- 字體：Noto Serif TC（標題）、Noto Sans TC（內文）、IBM Plex Mono（代碼）。
- 配色 CSS 變數完全照 Prototype.dc.html 第 16–17 行，含 `data-dark` 深色模式。
- KV binding 名稱 `NOTES`；key：`note:<path>`（JSON `{content, sha}`）、`meta:index`（JSON `SiteIndex`）。
- 前端路由用 hash：`#/`、`#/note/<encodeURIComponent(path)>`、`#/tag/<tag>`、`#/db`。

---

## 共用型別（多個任務引用，先定義於此）

`src/shared/types.ts`（Task 2 建立）：

```ts
export interface NoteMeta {
  path: string;            // repo 相對路徑，如 '好工具推薦/opencode-mcp.md'
  title: string;           // frontmatter.title 或檔名（去 .md）
  folder: string;          // 第一層資料夾名
  tags: string[];
  date: string | null;     // frontmatter date/updated，'YYYY-MM-DD'
  excerpt: string;         // 去 frontmatter/markdown 符號後前 160 字
  links: string[];         // 原始 wikilink 目標字串
  linksTo: string[];       // 解析成功的站內 path
  private: boolean;        // wiki/ 為 true
}
export interface SiteIndex {
  notes: NoteMeta[];
  builtAt: string;         // ISO 時間
}
```

---

### Task 1: 專案骨架（Vite + React + Hono Worker + Vitest）

**Files:**
- Create: `package.json`, `wrangler.jsonc`, `vite.config.ts`, `tsconfig.json`, `.gitignore`, `index.html`, `src/app/main.tsx`, `src/app/App.tsx`, `src/worker/index.ts`

**Interfaces:**
- Produces: Hono app export（`src/worker/index.ts` default export）、`Env` 型別 `{ NOTES: KVNamespace; AI: Ai; SITE_PASSWORD: string; SESSION_SECRET: string; WEBHOOK_SECRET: string; GITHUB_TOKEN: string; GITHUB_REPO: string; GITHUB_BRANCH: string; AI_MODEL: string }`、`GET /api/health` 回 `{ok:true}`。

- [ ] **Step 1: 建立 package.json 與安裝依賴**

```json
{
  "name": "my-note-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:worker": "wrangler dev",
    "build": "vite build",
    "test": "vitest run",
    "deploy": "vite build && wrangler deploy"
  }
}
```

Run: `npm i hono yaml && npm i -D vite @vitejs/plugin-react react react-dom @types/react @types/react-dom typescript vitest wrangler @cloudflare/workers-types markdown-it @types/markdown-it`
（react/react-dom 裝正式依賴：`npm i react react-dom markdown-it`，其餘 -D。）

- [ ] **Step 2: 設定檔**

`wrangler.jsonc`：

```jsonc
{
  "name": "my-note-web",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-06-01",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" },
  "kv_namespaces": [{ "binding": "NOTES", "id": "00000000000000000000000000000000" }],
  "ai": { "binding": "AI" },
  "vars": {
    "GITHUB_REPO": "hsjinde/my-note",
    "GITHUB_BRANCH": "main",
    "AI_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  }
}
```
（KV id 為本機開發用假值，Task 15 部署時以 `wrangler kv namespace create NOTES` 產生的真 id 取代。）

`vite.config.ts`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'node' },
});
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "skipLibCheck": true, "noEmit": true,
    "types": ["@cloudflare/workers-types", "vite/client"]
  },
  "include": ["src", "tests"]
}
```

`.gitignore`：

```
node_modules/
dist/
.wrangler/
```

- [ ] **Step 3: 最小 SPA 與 Worker**

`index.html`：

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>my-note</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;600;700&family=Noto+Sans+TC:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body><div id="root"></div><script type="module" src="/src/app/main.tsx"></script></body>
</html>
```

`src/app/main.tsx`：

```tsx
import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
```

`src/app/App.tsx`（暫時最小版，Task 11 起替換）：

```tsx
export default function App() { return <div>my-note</div>; }
```

`src/worker/index.ts`：

```ts
import { Hono } from 'hono';

export interface Env {
  NOTES: KVNamespace;
  AI: Ai;
  SITE_PASSWORD: string;
  SESSION_SECRET: string;
  WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  AI_MODEL: string;
}

const app = new Hono<{ Bindings: Env }>();
app.get('/api/health', (c) => c.json({ ok: true }));

export default app;
```

- [ ] **Step 4: 驗證可跑**

Run: `npm run build`（Expected: dist/ 產出、exit 0）
Run: `npx vitest run`（Expected: "No test files found" 或 exit 0——尚無測試屬正常）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 專案骨架（Vite + React + Hono Worker）"
```

---

### Task 2: 內容規則與筆記解析（content.ts）

**Files:**
- Create: `src/shared/types.ts`（內容見上方「共用型別」）
- Create: `src/worker/content.ts`
- Test: `tests/content.test.ts`

**Interfaces:**
- Produces: `isPublicPath(path: string): boolean`、`isIndexedPath(path: string): boolean`、`parseNote(path: string, md: string): NoteMeta`（此時 `linksTo` 回空陣列，Task 3 的 buildIndex 才解析）。

- [ ] **Step 1: 寫失敗測試**

`tests/content.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isPublicPath, isIndexedPath, parseNote } from '../src/worker/content';

describe('路徑規則', () => {
  it('白名單資料夾的 .md 是公開', () => {
    expect(isPublicPath('個人學習/a.md')).toBe(true);
    expect(isPublicPath('好工具推薦/x/y.md')).toBe(true);
    expect(isPublicPath('工作專案/b.md')).toBe(true);
  });
  it('wiki 與其他資料夾不公開', () => {
    expect(isPublicPath('wiki/entities/k.md')).toBe(false);
    expect(isPublicPath('日常/d.md')).toBe(false);
    expect(isPublicPath('個人學習/img.png')).toBe(false);
  });
  it('AI 索引 = 白名單 + wiki', () => {
    expect(isIndexedPath('wiki/k.md')).toBe(true);
    expect(isIndexedPath('個人學習/a.md')).toBe(true);
    expect(isIndexedPath('日常/d.md')).toBe(false);
  });
});

describe('parseNote', () => {
  const md = `---\ntitle: OpenCode MCP 配置指南\ntags: [tool, mcp]\ndate: 2026-06-07\n---\n\n> 本筆記記錄 OpenCode 已配置的 MCP servers。\n\n見 [[oc-go-cc 設定指南]] 與 [[wiki-page|別名]]。`;
  const meta = parseNote('好工具推薦/opencode-mcp.md', md);
  it('讀 frontmatter', () => {
    expect(meta.title).toBe('OpenCode MCP 配置指南');
    expect(meta.tags).toEqual(['tool', 'mcp']);
    expect(meta.date).toBe('2026-06-07');
    expect(meta.folder).toBe('好工具推薦');
    expect(meta.private).toBe(false);
  });
  it('抓 wikilink 目標', () => {
    expect(meta.links).toEqual(['oc-go-cc 設定指南', 'wiki-page']);
  });
  it('excerpt 去除 markdown 符號', () => {
    expect(meta.excerpt).toContain('本筆記記錄 OpenCode');
    expect(meta.excerpt).not.toContain('>');
    expect(meta.excerpt.length).toBeLessThanOrEqual(160);
  });
  it('無 frontmatter 用檔名當標題、date null', () => {
    const m = parseNote('wiki/k.md', '# 內文');
    expect(m.title).toBe('k');
    expect(m.date).toBeNull();
    expect(m.private).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/content.test.ts`
Expected: FAIL（模組不存在）

- [ ] **Step 3: 實作 content.ts**

先建 `src/shared/types.ts`（內容照本文件開頭「共用型別」），再：

```ts
import { parse as parseYaml } from 'yaml';
import type { NoteMeta } from '../shared/types';

export const PUBLIC_FOLDERS = ['個人學習', '好工具推薦', '工作專案'];
export const AI_EXTRA_FOLDERS = ['wiki'];

const inFolders = (path: string, folders: string[]) =>
  folders.some((f) => path.startsWith(f + '/'));

export function isPublicPath(path: string): boolean {
  return path.endsWith('.md') && inFolders(path, PUBLIC_FOLDERS);
}
export function isIndexedPath(path: string): boolean {
  return path.endsWith('.md') && inFolders(path, [...PUBLIC_FOLDERS, ...AI_EXTRA_FOLDERS]);
}

export function splitFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: md };
  let fm: Record<string, unknown> = {};
  try { fm = (parseYaml(m[1]) as Record<string, unknown>) ?? {}; } catch { fm = {}; }
  return { fm, body: md.slice(m[0].length) };
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

export function parseNote(path: string, md: string): NoteMeta {
  const { fm, body } = splitFrontmatter(md);
  const filename = path.split('/').pop()!.replace(/\.md$/, '');
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
  const rawDate = fm.date ?? fm.updated ?? null;
  const links = [...body.matchAll(WIKILINK)].map((m) => m[1].trim());
  const plain = body
    .replace(WIKILINK, (_, t) => t)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_\[\]!|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    path,
    title: typeof fm.title === 'string' && fm.title ? fm.title : filename,
    folder: path.split('/')[0],
    tags,
    date: rawDate ? String(rawDate).slice(0, 10) : null,
    excerpt: plain.slice(0, 160),
    links,
    linksTo: [],
    private: !isPublicPath(path),
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/content.test.ts`
Expected: PASS 全綠

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/worker/content.ts tests/content.test.ts
git commit -m "feat: 內容白名單規則與筆記解析"
```

---

### Task 3: 索引建置（buildIndex + publicIndex）

**Files:**
- Modify: `src/worker/content.ts`
- Test: `tests/index-build.test.ts`

**Interfaces:**
- Consumes: `parseNote`、`NoteMeta`、`SiteIndex`
- Produces: `buildIndex(files: {path: string; content: string}[]): SiteIndex`（解析 wikilink → `linksTo`，比對目標＝檔名（去 .md）或 title，大小寫不敏感）、`publicIndex(index: SiteIndex): SiteIndex`（過濾 private）。

- [ ] **Step 1: 寫失敗測試**

`tests/index-build.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildIndex, publicIndex } from '../src/worker/content';

const files = [
  { path: '好工具推薦/a.md', content: '---\ntitle: 筆記A\n---\n連到 [[筆記B]] 和 [[wiki-k]] 和 [[不存在]]' },
  { path: '好工具推薦/b.md', content: '---\ntitle: 筆記B\n---\n內容' },
  { path: 'wiki/wiki-k.md', content: 'wiki 內容' },
];

describe('buildIndex', () => {
  const idx = buildIndex(files);
  it('包含全部索引筆記', () => expect(idx.notes.length).toBe(3));
  it('wikilink 解析成 path（含指向 wiki）', () => {
    const a = idx.notes.find((n) => n.path === '好工具推薦/a.md')!;
    expect(a.linksTo).toEqual(['好工具推薦/b.md', 'wiki/wiki-k.md']);
  });
  it('builtAt 是 ISO 字串', () => expect(idx.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/));
});

describe('publicIndex', () => {
  it('過濾 private 筆記且 linksTo 不含 wiki path', () => {
    const pub = publicIndex(buildIndex(files));
    expect(pub.notes.map((n) => n.path)).toEqual(['好工具推薦/a.md', '好工具推薦/b.md']);
    const a = pub.notes.find((n) => n.path === '好工具推薦/a.md')!;
    expect(a.linksTo).toEqual(['好工具推薦/b.md']);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/index-build.test.ts`
Expected: FAIL（buildIndex 未定義）

- [ ] **Step 3: 實作（附加到 content.ts）**

```ts
import type { SiteIndex } from '../shared/types';

export function buildIndex(files: { path: string; content: string }[]): SiteIndex {
  const notes = files.filter((f) => isIndexedPath(f.path)).map((f) => parseNote(f.path, f.content));
  const byKey = new Map<string, string>(); // 檔名/title（小寫）→ path
  for (const n of notes) {
    byKey.set(n.path.split('/').pop()!.replace(/\.md$/, '').toLowerCase(), n.path);
    byKey.set(n.title.toLowerCase(), n.path);
  }
  for (const n of notes) {
    n.linksTo = n.links
      .map((t) => byKey.get(t.toLowerCase()))
      .filter((p): p is string => !!p && p !== n.path);
  }
  return { notes, builtAt: new Date().toISOString() };
}

export function publicIndex(index: SiteIndex): SiteIndex {
  const pubPaths = new Set(index.notes.filter((n) => !n.private).map((n) => n.path));
  return {
    builtAt: index.builtAt,
    notes: index.notes
      .filter((n) => !n.private)
      .map((n) => ({ ...n, linksTo: n.linksTo.filter((p) => pubPaths.has(p)) })),
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/index-build.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/content.ts tests/index-build.test.ts
git commit -m "feat: 索引建置與公開索引過濾"
```

---

### Task 4: Session 認證（auth.ts）

**Files:**
- Create: `src/worker/auth.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Produces: `createSession(secret: string, now?: number): Promise<string>`（token 格式 `<expMillis>.<hmacHex>`，效期 30 天）、`verifySession(token: string | undefined | null, secret: string, now?: number): Promise<boolean>`、`SESSION_MAX_AGE = 2592000`（秒）。

- [ ] **Step 1: 寫失敗測試**

`tests/auth.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createSession, verifySession } from '../src/worker/auth';

describe('session', () => {
  it('簽發後可驗證', async () => {
    const t = await createSession('secret');
    expect(await verifySession(t, 'secret')).toBe(true);
  });
  it('錯誤 secret 驗證失敗', async () => {
    const t = await createSession('secret');
    expect(await verifySession(t, 'other')).toBe(false);
  });
  it('過期 token 失敗', async () => {
    const t = await createSession('secret', Date.now() - 31 * 86400_000);
    expect(await verifySession(t, 'secret')).toBe(false);
  });
  it('竄改 payload 失敗', async () => {
    const t = await createSession('secret');
    const forged = String(Number(t.split('.')[0]) + 99999999) + '.' + t.split('.')[1];
    expect(await verifySession(forged, 'secret')).toBe(false);
  });
  it('空值失敗', async () => {
    expect(await verifySession(undefined, 'secret')).toBe(false);
    expect(await verifySession('garbage', 'secret')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 auth.ts**

```ts
export const SESSION_MAX_AGE = 2592000; // 秒（30 天）

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_MAX_AGE * 1000);
  return `${exp}.${await hmacHex(secret, exp)}`;
}

export async function verifySession(
  token: string | undefined | null, secret: string, now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expect = await hmacHex(secret, exp);
  if (sig.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/auth.ts tests/auth.test.ts
git commit -m "feat: HMAC session 簽發與驗證"
```

---

### Task 5: GitHub webhook 簽章驗證（webhook.ts）

**Files:**
- Create: `src/worker/webhook.ts`
- Test: `tests/webhook.test.ts`

**Interfaces:**
- Produces: `verifyGithubSignature(secret: string, rawBody: string, sigHeader: string | undefined | null): Promise<boolean>`（GitHub `X-Hub-Signature-256` 格式 `sha256=<hex>`）。

- [ ] **Step 1: 寫失敗測試**

`tests/webhook.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { verifyGithubSignature } from '../src/worker/webhook';

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyGithubSignature', () => {
  it('正確簽章通過', async () => {
    const body = '{"ref":"refs/heads/main"}';
    expect(await verifyGithubSignature('whsec', body, await sign('whsec', body))).toBe(true);
  });
  it('錯誤 secret / 竄改 body / 缺 header 皆失敗', async () => {
    const body = '{"a":1}';
    const good = await sign('whsec', body);
    expect(await verifyGithubSignature('other', body, good)).toBe(false);
    expect(await verifyGithubSignature('whsec', '{"a":2}', good)).toBe(false);
    expect(await verifyGithubSignature('whsec', body, undefined)).toBe(false);
    expect(await verifyGithubSignature('whsec', body, 'sha256=zz')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/webhook.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 webhook.ts**

```ts
export async function verifyGithubSignature(
  secret: string, rawBody: string, sigHeader: string | undefined | null,
): Promise<boolean> {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const given = sigHeader.slice('sha256='.length).toLowerCase();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expect = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (given.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/webhook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/webhook.ts tests/webhook.test.ts
git commit -m "feat: GitHub webhook HMAC 簽章驗證"
```

---

### Task 6: GitHub API client（github.ts）

**Files:**
- Create: `src/worker/github.ts`
- Test: `tests/github.test.ts`

**Interfaces:**
- Produces: `class GitHub { constructor(token: string, repo: string, branch: string); listMarkdownPaths(): Promise<string[]>; getFile(path: string): Promise<{content: string; sha: string} | null>; putFile(path: string, content: string, message: string, sha?: string): Promise<{sha: string}> }`
- putFile 遇 GitHub 409/422（sha 衝突）throw `ShaConflictError`（`export class ShaConflictError extends Error`）。

- [ ] **Step 1: 寫失敗測試（mock global fetch）**

`tests/github.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitHub, ShaConflictError } from '../src/worker/github';

const gh = () => new GitHub('tok', 'hsjinde/my-note', 'main');
afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => handler(String(url), init)));
}

describe('GitHub client', () => {
  it('listMarkdownPaths 過濾出 .md blob', async () => {
    stubFetch((url) => {
      expect(url).toBe('https://api.github.com/repos/hsjinde/my-note/git/trees/main?recursive=1');
      return Response.json({ tree: [
        { path: '個人學習/a.md', type: 'blob' },
        { path: '個人學習', type: 'tree' },
        { path: 'img/x.png', type: 'blob' },
      ]});
    });
    expect(await gh().listMarkdownPaths()).toEqual(['個人學習/a.md']);
  });

  it('getFile 解 base64（UTF-8 中文）並回 sha', async () => {
    const content = '# 中文內容';
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(content)));
    stubFetch((url) => {
      expect(decodeURIComponent(url)).toContain('/contents/個人學習/a.md?ref=main');
      return Response.json({ content: b64, sha: 'abc123', encoding: 'base64' });
    });
    expect(await gh().getFile('個人學習/a.md')).toEqual({ content, sha: 'abc123' });
  });

  it('getFile 404 回 null', async () => {
    stubFetch(() => new Response('nf', { status: 404 }));
    expect(await gh().getFile('x.md')).toBeNull();
  });

  it('putFile 帶 message/branch/sha 且回新 sha', async () => {
    stubFetch(async (url, init) => {
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init?.body));
      expect(body.message).toBe('docs: 網頁編輯「筆記A」');
      expect(body.branch).toBe('main');
      expect(body.sha).toBe('old');
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)));
      expect(decoded).toBe('新內容');
      return Response.json({ content: { sha: 'new456' } }, { status: 200 });
    });
    expect(await gh().putFile('個人學習/a.md', '新內容', 'docs: 網頁編輯「筆記A」', 'old')).toEqual({ sha: 'new456' });
  });

  it('putFile sha 衝突丟 ShaConflictError', async () => {
    stubFetch(() => new Response('conflict', { status: 409 }));
    await expect(gh().putFile('a.md', 'x', 'm', 'old')).rejects.toBeInstanceOf(ShaConflictError);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/github.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 github.ts**

```ts
export class ShaConflictError extends Error {}

const b64encodeUtf8 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64decodeUtf8 = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

export class GitHub {
  constructor(private token: string, private repo: string, private branch: string) {}

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'my-note-web',
        ...(init.headers ?? {}),
      },
    });
  }

  async listMarkdownPaths(): Promise<string[]> {
    const res = await this.req(`/git/trees/${this.branch}?recursive=1`);
    if (!res.ok) throw new Error(`getTree failed: ${res.status}`);
    const data = (await res.json()) as { tree: { path: string; type: string }[] };
    return data.tree.filter((t) => t.type === 'blob' && t.path.endsWith('.md')).map((t) => t.path);
  }

  async getFile(path: string): Promise<{ content: string; sha: string } | null> {
    const res = await this.req(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${this.branch}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`getFile ${path} failed: ${res.status}`);
    const data = (await res.json()) as { content: string; sha: string };
    return { content: b64decodeUtf8(data.content), sha: data.sha };
  }

  async putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string }> {
    const res = await this.req(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      body: JSON.stringify({ message, branch: this.branch, content: b64encodeUtf8(content), ...(sha ? { sha } : {}) }),
    });
    if (res.status === 409 || res.status === 422) throw new ShaConflictError(`sha conflict for ${path}`);
    if (!res.ok) throw new Error(`putFile ${path} failed: ${res.status}`);
    const data = (await res.json()) as { content: { sha: string } };
    return { sha: data.content.sha };
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/github.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/github.ts tests/github.test.ts
git commit -m "feat: GitHub Contents API client"
```

---

### Task 7: 同步邏輯（sync.ts）

**Files:**
- Create: `src/worker/sync.ts`
- Create: `tests/helpers.ts`（mock KV，之後多個測試共用）
- Test: `tests/sync.test.ts`

**Interfaces:**
- Consumes: `GitHub`、`isIndexedPath`、`buildIndex`
- Produces:
  - `fullSync(kv: KVNamespace, gh: GitHub): Promise<{synced: number}>`
  - `incrementalSync(kv: KVNamespace, gh: GitHub, payload: PushPayload): Promise<{synced: number; removed: number}>`
  - `rebuildIndexFromKV(kv: KVNamespace): Promise<void>`（list 全部 `note:` → buildIndex → 寫 `meta:index`）
  - `type PushPayload = { commits?: { added?: string[]; modified?: string[]; removed?: string[] }[] }`
- KV 值格式：`note:<path>` = `JSON.stringify({content, sha})`；`meta:index` = `JSON.stringify(SiteIndex)`。

- [ ] **Step 1: 寫 mock KV helper + 失敗測試**

`tests/helpers.ts`：

```ts
export function mockKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async (opts: { prefix?: string } = {}) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((name) => ({ name })),
      list_complete: true,
      cursor: '',
    }),
  } as unknown as KVNamespace & { store: Map<string, string> };
}
```

`tests/sync.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { fullSync, incrementalSync } from '../src/worker/sync';
import { mockKV } from './helpers';
import type { GitHub } from '../src/worker/github';

function mockGH(files: Record<string, string>): GitHub {
  return {
    listMarkdownPaths: vi.fn(async () => Object.keys(files)),
    getFile: vi.fn(async (p: string) =>
      files[p] != null ? { content: files[p], sha: 'sha-' + p } : null),
    putFile: vi.fn(),
  } as unknown as GitHub;
}

describe('fullSync', () => {
  it('抓白名單+wiki、跳過其他、建索引', async () => {
    const kv = mockKV();
    const gh = mockGH({
      '個人學習/a.md': '---\ntitle: A\n---\n內容A',
      'wiki/k.md': 'wiki 內容',
      '日常/d.md': '不索引',
    });
    const r = await fullSync(kv, gh);
    expect(r.synced).toBe(2);
    expect(await kv.get('note:個人學習/a.md', 'json')).toEqual({ content: '---\ntitle: A\n---\n內容A', sha: 'sha-個人學習/a.md' });
    expect(await kv.get('note:日常/d.md')).toBeNull();
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string }[] };
    expect(idx.notes.length).toBe(2);
  });
});

describe('incrementalSync', () => {
  it('added/modified 更新、removed 刪除、重建索引', async () => {
    const kv = mockKV({
      'note:個人學習/old.md': JSON.stringify({ content: '舊', sha: 's1' }),
      'note:個人學習/gone.md': JSON.stringify({ content: '將刪', sha: 's2' }),
    });
    const gh = mockGH({ '個人學習/new.md': '新檔', '個人學習/old.md': '改過' });
    const r = await incrementalSync(kv, gh, {
      commits: [
        { added: ['個人學習/new.md', '圖/x.png'], modified: ['個人學習/old.md'], removed: ['個人學習/gone.md'] },
      ],
    });
    expect(r).toEqual({ synced: 2, removed: 1 });
    expect(await kv.get('note:個人學習/gone.md')).toBeNull();
    expect(((await kv.get('note:個人學習/old.md', 'json')) as { content: string }).content).toBe('改過');
    const idx = (await kv.get('meta:index', 'json')) as { notes: { path: string }[] };
    expect(idx.notes.map((n) => n.path).sort()).toEqual(['個人學習/new.md', '個人學習/old.md']);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/sync.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 sync.ts**

```ts
import type { GitHub } from './github';
import { buildIndex, isIndexedPath } from './content';

export type PushPayload = {
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
};

async function listNoteKeys(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await kv.list({ prefix: 'note:', cursor });
    keys.push(...res.keys.map((k) => k.name));
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

export async function rebuildIndexFromKV(kv: KVNamespace): Promise<void> {
  const keys = await listNoteKeys(kv);
  const files: { path: string; content: string }[] = [];
  for (const key of keys) {
    const v = (await kv.get(key, 'json')) as { content: string } | null;
    if (v) files.push({ path: key.slice('note:'.length), content: v.content });
  }
  await kv.put('meta:index', JSON.stringify(buildIndex(files)));
}

export async function fullSync(kv: KVNamespace, gh: GitHub): Promise<{ synced: number }> {
  const paths = (await gh.listMarkdownPaths()).filter(isIndexedPath);
  let synced = 0;
  for (const path of paths) {
    const file = await gh.getFile(path);
    if (!file) continue;
    await kv.put(`note:${path}`, JSON.stringify(file));
    synced++;
  }
  // 移除 repo 已不存在的舊 note
  const current = new Set(paths.map((p) => `note:${p}`));
  for (const key of await listNoteKeys(kv)) {
    if (!current.has(key)) await kv.delete(key);
  }
  await rebuildIndexFromKV(kv);
  return { synced };
}

export async function incrementalSync(
  kv: KVNamespace, gh: GitHub, payload: PushPayload,
): Promise<{ synced: number; removed: number }> {
  const changed = new Set<string>();
  const removedSet = new Set<string>();
  for (const c of payload.commits ?? []) {
    for (const p of [...(c.added ?? []), ...(c.modified ?? [])]) if (isIndexedPath(p)) { changed.add(p); removedSet.delete(p); }
    for (const p of c.removed ?? []) if (isIndexedPath(p)) { removedSet.add(p); changed.delete(p); }
  }
  let synced = 0;
  for (const path of changed) {
    const file = await gh.getFile(path);
    if (!file) { removedSet.add(path); continue; }
    await kv.put(`note:${path}`, JSON.stringify(file));
    synced++;
  }
  for (const path of removedSet) await kv.delete(`note:${path}`);
  if (synced || removedSet.size) await rebuildIndexFromKV(kv);
  return { synced, removed: removedSet.size };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/sync.ts tests/helpers.ts tests/sync.test.ts
git commit -m "feat: 全量與增量同步邏輯"
```

---

### Task 8: 公開 API 路由（/api/index、/api/note GET）

**Files:**
- Modify: `src/worker/index.ts`
- Test: `tests/routes-public.test.ts`

**Interfaces:**
- Consumes: `publicIndex`、`isPublicPath`
- Produces:
  - `GET /api/index` → `SiteIndex`（公開過濾後）；索引不存在回 `{notes: [], builtAt: null}`
  - `GET /api/note/<encoded path>` → `{path, content, sha}`；wiki/ 或不存在回 404
  - 測試呼叫方式：`app.request(url, init, env)`，env 用 `mockKV` 組出。

- [ ] **Step 1: 寫失敗測試**

`tests/routes-public.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import app from '../src/worker/index';
import { mockKV } from './helpers';
import { buildIndex } from '../src/worker/content';

function env(kvInit: Record<string, string> = {}) {
  return {
    NOTES: mockKV(kvInit),
    SITE_PASSWORD: 'pw', SESSION_SECRET: 'ss', WEBHOOK_SECRET: 'ws',
    GITHUB_TOKEN: 'tok', GITHUB_REPO: 'hsjinde/my-note', GITHUB_BRANCH: 'main',
    AI_MODEL: 'test-model', AI: { run: async () => ({ response: 'ok' }) },
  } as never;
}

const idx = buildIndex([
  { path: '個人學習/a.md', content: '---\ntitle: A\n---\n內容' },
  { path: 'wiki/k.md', content: '秘密' },
]);

describe('GET /api/index', () => {
  it('回公開索引（不含 wiki）', async () => {
    const res = await app.request('/api/index', {}, env({ 'meta:index': JSON.stringify(idx) }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { notes: { path: string }[] };
    expect(data.notes.map((n) => n.path)).toEqual(['個人學習/a.md']);
  });
  it('無索引回空', async () => {
    const res = await app.request('/api/index', {}, env());
    expect(((await res.json()) as { notes: unknown[] }).notes).toEqual([]);
  });
});

describe('GET /api/note/*', () => {
  const kv = {
    'note:個人學習/a.md': JSON.stringify({ content: '# A', sha: 's1' }),
    'note:wiki/k.md': JSON.stringify({ content: '秘密', sha: 's2' }),
  };
  it('公開筆記回內容與 sha', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {}, env(kv));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: '個人學習/a.md', content: '# A', sha: 's1' });
  });
  it('wiki 路徑回 404', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('wiki/k.md')}`, {}, env(kv));
    expect(res.status).toBe(404);
  });
  it('不存在回 404', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/none.md')}`, {}, env(kv));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/routes-public.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 worker/index.ts 加路由**

在 `app.get('/api/health', ...)` 之後加入（並在檔頭 import）：

```ts
import { isPublicPath, publicIndex } from './content';
import type { SiteIndex } from '../shared/types';

export function notePathFromUrl(url: string, prefix: string): string {
  const pathname = new URL(url).pathname;
  return decodeURIComponent(pathname.slice(prefix.length));
}

app.get('/api/index', async (c) => {
  const idx = (await c.env.NOTES.get('meta:index', 'json')) as SiteIndex | null;
  if (!idx) return c.json({ notes: [], builtAt: null });
  return c.json(publicIndex(idx));
});

app.get('/api/note/*', async (c) => {
  const path = notePathFromUrl(c.req.url, '/api/note/');
  if (!isPublicPath(path)) return c.json({ error: 'not found' }, 404);
  const note = (await c.env.NOTES.get(`note:${path}`, 'json')) as { content: string; sha: string } | null;
  if (!note) return c.json({ error: 'not found' }, 404);
  return c.json({ path, content: note.content, sha: note.sha });
});
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/routes-public.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/index.ts tests/routes-public.test.ts
git commit -m "feat: 公開 API（索引與筆記讀取）"
```

---

### Task 9: 認證路由與受保護 API（login/logout/me、PUT note、sync、webhook）

**Files:**
- Modify: `src/worker/index.ts`
- Test: `tests/routes-auth.test.ts`

**Interfaces:**
- Consumes: `createSession`、`verifySession`、`SESSION_MAX_AGE`、`verifyGithubSignature`、`fullSync`、`incrementalSync`、`GitHub`、`ShaConflictError`、`parseNote`
- Produces:
  - `POST /api/login` body `{password}` → 200 + Set-Cookie `session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`；錯誤密碼 401
  - `POST /api/logout` → 清 cookie（Max-Age=0）
  - `GET /api/me` → `{authed: boolean}`
  - `PUT /api/note/<encoded path>`（登入）body `{content, sha}` → GitHub commit（message `docs: 網頁編輯「<標題>」`，標題用 `parseNote` 取）→ 更新 KV + 重建索引 → `{sha: <新sha>}`；未登入 401；sha 衝突 409；非白名單路徑 404
  - `POST /api/sync`（登入）→ fullSync → `{synced}`
  - `POST /api/webhook`（HMAC）→ incrementalSync → `{synced, removed}`；簽章錯 401

- [ ] **Step 1: 寫失敗測試**

`tests/routes-auth.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/worker/index';
import { mockKV } from './helpers';
import { createSession } from '../src/worker/auth';
import { buildIndex } from '../src/worker/content';

afterEach(() => vi.unstubAllGlobals());

function env(kvInit: Record<string, string> = {}) {
  return {
    NOTES: mockKV(kvInit),
    SITE_PASSWORD: 'pw', SESSION_SECRET: 'ss', WEBHOOK_SECRET: 'ws',
    GITHUB_TOKEN: 'tok', GITHUB_REPO: 'hsjinde/my-note', GITHUB_BRANCH: 'main',
    AI_MODEL: 'test-model', AI: { run: async () => ({ response: 'ok' }) },
  } as never;
}
const authedHeaders = async () => ({ Cookie: `session=${await createSession('ss')}` });

describe('login/logout/me', () => {
  it('正確密碼發 cookie', async () => {
    const res = await app.request('/api/login', {
      method: 'POST', body: JSON.stringify({ password: 'pw' }),
      headers: { 'Content-Type': 'application/json' },
    }, env());
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!;
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=2592000');
  });
  it('錯誤密碼 401', async () => {
    const res = await app.request('/api/login', {
      method: 'POST', body: JSON.stringify({ password: 'no' }),
      headers: { 'Content-Type': 'application/json' },
    }, env());
    expect(res.status).toBe(401);
  });
  it('me 反映登入狀態', async () => {
    const anon = await app.request('/api/me', {}, env());
    expect(await anon.json()).toEqual({ authed: false });
    const authed = await app.request('/api/me', { headers: await authedHeaders() }, env());
    expect(await authed.json()).toEqual({ authed: true });
  });
});

describe('PUT /api/note/*', () => {
  const kvInit = {
    'note:個人學習/a.md': JSON.stringify({ content: '---\ntitle: 筆記A\n---\n舊', sha: 'old' }),
    'meta:index': JSON.stringify(buildIndex([{ path: '個人學習/a.md', content: '---\ntitle: 筆記A\n---\n舊' }])),
  };
  it('未登入 401', async () => {
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {
      method: 'PUT', body: JSON.stringify({ content: 'x', sha: 'old' }),
      headers: { 'Content-Type': 'application/json' },
    }, env(kvInit));
    expect(res.status).toBe(401);
  });
  it('登入後 commit 到 GitHub 並更新 KV', async () => {
    let captured: { message?: string } = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return Response.json({ content: { sha: 'new1' } });
    }));
    const e = env(kvInit);
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {
      method: 'PUT',
      body: JSON.stringify({ content: '---\ntitle: 筆記A\n---\n新內容', sha: 'old' }),
      headers: { 'Content-Type': 'application/json', ...(await authedHeaders()) },
    }, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha: 'new1' });
    expect(captured.message).toBe('docs: 網頁編輯「筆記A」');
    const kv = (e as { NOTES: { get: (k: string, t: string) => Promise<unknown> } }).NOTES;
    expect(await kv.get('note:個人學習/a.md', 'json')).toEqual({ content: '---\ntitle: 筆記A\n---\n新內容', sha: 'new1' });
  });
  it('sha 衝突回 409', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('conflict', { status: 409 })));
    const res = await app.request(`/api/note/${encodeURIComponent('個人學習/a.md')}`, {
      method: 'PUT', body: JSON.stringify({ content: 'x', sha: 'stale' }),
      headers: { 'Content-Type': 'application/json', ...(await authedHeaders()) },
    }, env(kvInit));
    expect(res.status).toBe(409);
  });
});

describe('POST /api/webhook', () => {
  async function sign(body: string) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('ws'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  it('壞簽章 401', async () => {
    const res = await app.request('/api/webhook', {
      method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=00' },
    }, env());
    expect(res.status).toBe(401);
  });
  it('好簽章觸發增量同步', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      content: btoa(String.fromCharCode(...new TextEncoder().encode('新'))), sha: 's9', encoding: 'base64',
    })));
    const body = JSON.stringify({ commits: [{ added: ['個人學習/n.md'], modified: [], removed: [] }] });
    const res = await app.request('/api/webhook', {
      method: 'POST', body, headers: { 'X-Hub-Signature-256': await sign(body) },
    }, env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 1, removed: 0 });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/routes-auth.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 worker/index.ts 加認證與受保護路由**

檔頭補 import，並加入：

```ts
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { createSession, verifySession, SESSION_MAX_AGE } from './auth';
import { verifyGithubSignature } from './webhook';
import { fullSync, incrementalSync, rebuildIndexFromKV, type PushPayload } from './sync';
import { GitHub, ShaConflictError } from './github';
import { parseNote } from './content';

const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!(await verifySession(getCookie(c, 'session'), c.env.SESSION_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

const github = (env: Env) => new GitHub(env.GITHUB_TOKEN, env.GITHUB_REPO, env.GITHUB_BRANCH);

app.post('/api/login', async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (password !== c.env.SITE_PASSWORD) return c.json({ error: 'wrong password' }, 401);
  setCookie(c, 'session', await createSession(c.env.SESSION_SECRET), {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MAX_AGE,
  });
  return c.json({ ok: true });
});

app.post('/api/logout', (c) => {
  setCookie(c, 'session', '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 0 });
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  return c.json({ authed: await verifySession(getCookie(c, 'session'), c.env.SESSION_SECRET) });
});

app.put('/api/note/*', requireAuth, async (c) => {
  const path = notePathFromUrl(c.req.url, '/api/note/');
  if (!isPublicPath(path)) return c.json({ error: 'not found' }, 404);
  const { content, sha } = await c.req.json<{ content: string; sha: string }>();
  const title = parseNote(path, content).title;
  try {
    const result = await github(c.env).putFile(path, content, `docs: 網頁編輯「${title}」`, sha);
    await c.env.NOTES.put(`note:${path}`, JSON.stringify({ content, sha: result.sha }));
    await rebuildIndexFromKV(c.env.NOTES);
    return c.json({ sha: result.sha });
  } catch (e) {
    if (e instanceof ShaConflictError) return c.json({ error: 'sha conflict' }, 409);
    throw e;
  }
});

app.post('/api/sync', requireAuth, async (c) => {
  return c.json(await fullSync(c.env.NOTES, github(c.env)));
});

app.post('/api/webhook', async (c) => {
  const raw = await c.req.text();
  const ok = await verifyGithubSignature(c.env.WEBHOOK_SECRET, raw, c.req.header('X-Hub-Signature-256'));
  if (!ok) return c.json({ error: 'bad signature' }, 401);
  const payload = JSON.parse(raw) as PushPayload;
  return c.json(await incrementalSync(c.env.NOTES, github(c.env), payload));
});
```

- [ ] **Step 4: 跑全部測試確認通過**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/index.ts tests/routes-auth.test.ts
git commit -m "feat: 登入、編輯回寫、同步與 webhook 路由"
```

---

### Task 10: AI 問答（ask.ts + /api/ask）

**Files:**
- Create: `src/worker/ask.ts`
- Modify: `src/worker/index.ts`
- Test: `tests/ask.test.ts`

**Interfaces:**
- Consumes: `SiteIndex`、`NoteMeta`
- Produces:
  - `tokenize(q: string): string[]`（拉丁字詞 + CJK bigram）
  - `scoreNotes(index: SiteIndex, question: string, topN?: number): NoteMeta[]`（title 命中 +5、tag +3、excerpt +1；全 0 分時 fallback 取 date 最新 3 篇；預設 topN=4）
  - `ask(env: {NOTES: KVNamespace; AI: Ai; AI_MODEL: string}, question: string): Promise<string>`
  - `POST /api/ask`（登入）body `{question}` → `{answer}`

- [ ] **Step 1: 寫失敗測試**

`tests/ask.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { tokenize, scoreNotes, ask } from '../src/worker/ask';
import { buildIndex } from '../src/worker/content';
import { mockKV } from './helpers';

const idx = buildIndex([
  { path: '好工具推薦/opencode-mcp.md', content: '---\ntitle: OpenCode MCP 配置指南\ntags: [mcp]\ndate: 2026-06-07\n---\nnotebooklm 重新登入 nlm login' },
  { path: '個人學習/llm.md', content: '---\ntitle: LLM Wiki\ndate: 2026-05-24\n---\n向量檢索' },
  { path: 'wiki/k.md', content: '---\ntitle: Karpathy\ndate: 2026-01-01\n---\n人物' },
]);

describe('tokenize', () => {
  it('拉丁詞 + CJK bigram', () => {
    expect(tokenize('notebooklm 登入')).toEqual(['notebooklm', '登入']);
    expect(tokenize('重新登入')).toEqual(['重新', '新登', '登入']);
  });
});

describe('scoreNotes', () => {
  it('依關鍵字命中排序，wiki 也在候選', () => {
    const top = scoreNotes(idx, 'notebooklm 要怎麼重新登入？');
    expect(top[0].path).toBe('好工具推薦/opencode-mcp.md');
  });
  it('全無命中 fallback 最新 3 篇', () => {
    const top = scoreNotes(idx, 'zzzz');
    expect(top.length).toBe(3);
    expect(top[0].date).toBe('2026-06-07');
  });
});

describe('ask', () => {
  it('組 prompt 呼叫 AI 並回答', async () => {
    const kv = mockKV({
      'meta:index': JSON.stringify(idx),
      'note:好工具推薦/opencode-mcp.md': JSON.stringify({ content: 'nlm login 說明', sha: 's' }),
      'note:個人學習/llm.md': JSON.stringify({ content: '向量', sha: 's' }),
      'note:wiki/k.md': JSON.stringify({ content: '人物', sha: 's' }),
    });
    const run = vi.fn(async (_m: string, input: { messages: { role: string; content: string }[] }) => {
      expect(input.messages[0].role).toBe('system');
      expect(input.messages[0].content).toContain('nlm login 說明');
      expect(input.messages[1]).toEqual({ role: 'user', content: 'notebooklm 怎麼登入' });
      return { response: '執行 nlm login' };
    });
    const answer = await ask({ NOTES: kv, AI: { run } as never, AI_MODEL: 'm' }, 'notebooklm 怎麼登入');
    expect(answer).toBe('執行 nlm login');
    expect(run).toHaveBeenCalledWith('m', expect.anything());
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/ask.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 ask.ts**

```ts
import type { NoteMeta, SiteIndex } from '../shared/types';

export function tokenize(q: string): string[] {
  const tokens: string[] = [];
  for (const m of q.toLowerCase().matchAll(/[a-z0-9_.-]+/g)) tokens.push(m[0]);
  for (const m of q.matchAll(/[一-鿿]+/g)) {
    const run = m[0];
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i + 1 < run.length; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

export function scoreNotes(index: SiteIndex, question: string, topN = 4): NoteMeta[] {
  const tokens = tokenize(question);
  const scored = index.notes.map((n) => {
    let score = 0;
    const title = n.title.toLowerCase();
    const excerpt = n.excerpt.toLowerCase();
    for (const t of tokens) {
      if (title.includes(t)) score += 5;
      if (n.tags.some((tag) => tag.toLowerCase().includes(t))) score += 3;
      if (excerpt.includes(t)) score += 1;
    }
    return { n, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (hits.length) return hits.slice(0, topN).map((s) => s.n);
  return [...index.notes]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 3);
}

export async function ask(
  env: { NOTES: KVNamespace; AI: Ai; AI_MODEL: string }, question: string,
): Promise<string> {
  const index = (await env.NOTES.get('meta:index', 'json')) as SiteIndex | null;
  if (!index || !index.notes.length) return '資料庫還沒有內容，請先執行同步。';
  const top = scoreNotes(index, question);
  const sections: string[] = [];
  for (const n of top) {
    const note = (await env.NOTES.get(`note:${n.path}`, 'json')) as { content: string } | null;
    if (note) sections.push(`【${n.title}】（${n.path}）\n${note.content.slice(0, 6000)}`);
  }
  const system =
    '你是個人筆記資料庫的問答助手。僅根據以下筆記內容回答，使用繁體中文，回答簡潔。' +
    '若筆記中沒有相關內容，請直接說明找不到，不要編造。\n\n' + sections.join('\n\n---\n\n');
  const result = (await env.AI.run(env.AI_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
  })) as { response?: string };
  return result.response ?? '（模型沒有回覆）';
}
```

在 `src/worker/index.ts` 加路由（import `ask`）：

```ts
import { ask } from './ask';

app.post('/api/ask', requireAuth, async (c) => {
  const { question } = await c.req.json<{ question: string }>();
  if (!question?.trim()) return c.json({ error: 'empty question' }, 400);
  return c.json({ answer: await ask(c.env, question.trim()) });
});
```

- [ ] **Step 4: 跑全部測試確認通過**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/ask.ts src/worker/index.ts tests/ask.test.ts
git commit -m "feat: Workers AI 問答（輕量 RAG）"
```

---

### Task 11: 前端主題、markdown 渲染與 API client

**Files:**
- Create: `src/app/theme.css`, `src/app/markdown.ts`, `src/app/api.ts`
- Test: `tests/markdown.test.ts`

**Interfaces:**
- Produces:
  - `renderMarkdown(md: string, resolve: (target: string) => string | null): { html: string; toc: { level: 2 | 3; text: string; id: string }[] }`——resolve 回站內 path（成功）或 null（失效連結）；wikilink 轉 `<a class="wikilink" href="#/note/<encoded>">`，失效轉 `<span class="broken-link">`；h2/h3 加 id 進 toc；frontmatter 移除；callout 標記 `[!type]` 移除。
  - api.ts：`fetchIndex(): Promise<SiteIndex>`、`fetchNote(path: string): Promise<{path: string; content: string; sha: string}>`、`saveNote(path: string, content: string, sha: string): Promise<{sha: string}>`（409 時 throw `Error('conflict')`）、`login(password: string): Promise<boolean>`、`me(): Promise<boolean>`、`askDb(question: string): Promise<string>`（401 時 throw `Error('unauthorized')`）、`triggerSync(): Promise<void>`
  - theme.css：原型的亮/暗 CSS 變數 + 基本排版 class（`.md-body` 內文樣式）。

- [ ] **Step 1: 寫失敗測試（markdown 純函式）**

`tests/markdown.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/app/markdown';

const resolve = (t: string) => (t === '筆記B' ? '好工具推薦/b.md' : null);

describe('renderMarkdown', () => {
  it('移除 frontmatter、渲染標題與表格', () => {
    const { html } = renderMarkdown('---\ntitle: X\n---\n## 標題\n\n| a | b |\n|---|---|\n| 1 | 2 |', resolve);
    expect(html).not.toContain('title: X');
    expect(html).toContain('<h2');
    expect(html).toContain('<table>');
  });
  it('wikilink 解析成站內連結、失效變 span', () => {
    const { html } = renderMarkdown('見 [[筆記B|B 別名]] 與 [[不存在]]', resolve);
    expect(html).toContain(`href="#/note/${encodeURIComponent('好工具推薦/b.md')}"`);
    expect(html).toContain('>B 別名</a>');
    expect(html).toContain('<span class="broken-link">不存在</span>');
  });
  it('toc 收集 h2/h3 並加 id', () => {
    const { html, toc } = renderMarkdown('## 甲\n\n### 乙\n\n#### 丙', resolve);
    expect(toc).toEqual([
      { level: 2, text: '甲', id: 'h-甲' },
      { level: 3, text: '乙', id: 'h-乙' },
    ]);
    expect(html).toContain('id="h-甲"');
  });
  it('callout 標記移除', () => {
    const { html } = renderMarkdown('> [!tip] 小技巧\n> 內容', resolve);
    expect(html).not.toContain('[!tip]');
    expect(html).toContain('<blockquote>');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/markdown.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 markdown.ts**

注意：`MarkdownIt({html: false})` 會轉義內嵌 HTML，因此 wikilink 用「先換佔位 token、渲染後換回 HTML」的策略：

```ts
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderMarkdown(
  source: string, resolve: (target: string) => string | null,
): { html: string; toc: { level: 2 | 3; text: string; id: string }[] } {
  let body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  body = body.replace(/^(>\s*)\[!\w+\]\s*(.*)$/gm, (_, p: string, rest: string) =>
    rest ? `${p}**${rest}**` : p.trimEnd());

  const placeholders: string[] = [];
  body = body.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, _a, alias?: string) => {
    const label = alias ?? target.trim();
    const path = resolve(target.trim());
    placeholders.push(path
      ? `<a class="wikilink" href="#/note/${encodeURIComponent(path)}">${esc(label)}</a>`
      : `<span class="broken-link">${esc(label)}</span>`);
    return ` WIKI${placeholders.length - 1} `;
  });

  const env = {};
  const tokens = md.parse(body, env);
  const toc: { level: 2 | 3; text: string; id: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && (t.tag === 'h2' || t.tag === 'h3')) {
      const text = tokens[i + 1]?.children?.map((c) => c.content).join('') ?? '';
      const id = 'h-' + text.trim().replace(/\s+/g, '-');
      t.attrSet('id', id);
      toc.push({ level: t.tag === 'h2' ? 2 : 3, text: text.trim(), id });
    }
  }
  let html = md.renderer.render(tokens, md.options, env);
  html = html.replace(/ WIKI(\d+) /g, (_, i: string) => placeholders[Number(i)]);
  return { html, toc };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/markdown.test.ts`
Expected: PASS

- [ ] **Step 5: 寫 theme.css 與 api.ts（無單元測試，Task 12 起使用）**

`src/app/theme.css`：

```css
:root{--bg:#fbf7ef;--pn:#fff;--ln:#e4d9c6;--ls:#f1ead9;--tx:#5a4f3e;--hd:#3a3226;--mu:#c2b39a;--ac:#c26b3e;--ab:rgba(194,107,62,.10);--a2:#d9a06b;--qb:rgba(194,107,62,.06);--cb:#f4eee1;--ci:#efe7d4;--rw:rgba(228,217,198,.25);--hl:#f6d36b88}
[data-dark="true"]{--bg:#1c1917;--pn:#262220;--ln:#38322d;--ls:#2a2622;--tx:#d9d2c7;--hd:#f2ece1;--mu:#8d8375;--ac:#ec9566;--ab:rgba(236,149,102,.13);--a2:#b06a42;--qb:rgba(236,149,102,.07);--cb:#161311;--ci:#38322d;--rw:rgba(56,50,45,.35);--hl:rgba(246,211,107,.28)}
*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans TC',system-ui,sans-serif}
a{color:var(--ac)}a:hover{color:var(--a2)}
.md-body{font-size:15.5px;line-height:2.05;color:var(--tx)}
.md-body h1,.md-body h2,.md-body h3{font-family:'Noto Serif TC',serif;color:var(--hd)}
.md-body h2{font-size:24px;font-weight:600;margin:34px 0 16px;padding-bottom:8px;border-bottom:1px solid var(--ln)}
.md-body h3{font-size:18px;font-weight:600;margin:24px 0 12px}
.md-body code{font:13.5px 'IBM Plex Mono',monospace;background:var(--ci);border-radius:4px;padding:1px 6px;color:var(--hd)}
.md-body pre{background:var(--cb);border:1px solid var(--ln);border-radius:10px;padding:16px 18px;overflow-x:auto}
.md-body pre code{background:none;padding:0;font:13.5px/1.75 'IBM Plex Mono',monospace;color:var(--tx)}
.md-body blockquote{border-left:3px solid var(--a2);background:var(--qb);border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 30px}
.md-body blockquote p{margin:0}
.md-body table{width:100%;border-collapse:collapse;font-size:14.5px;margin-bottom:34px}
.md-body th{padding:9px 12px;border-bottom:2px solid var(--ln);font-weight:500;color:var(--hd);text-align:left}
.md-body td{padding:9px 12px;border-bottom:1px solid var(--ls)}
.md-body a.wikilink{color:var(--ac);text-decoration:underline;text-decoration-color:var(--a2);text-underline-offset:3px}
.md-body .broken-link{color:var(--mu);text-decoration:line-through dotted;cursor:not-allowed}
.md-body img{max-width:100%}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--ln);border-radius:5px}
```

`src/app/api.ts`：

```ts
import type { SiteIndex } from '../shared/types';

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new Error('unauthorized');
  if (res.status === 409) throw new Error('conflict');
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchIndex = () => fetch('/api/index').then((r) => json<SiteIndex>(r));
export const fetchNote = (path: string) =>
  fetch(`/api/note/${encodeURIComponent(path)}`).then((r) => json<{ path: string; content: string; sha: string }>(r));
export const saveNote = (path: string, content: string, sha: string) =>
  fetch(`/api/note/${encodeURIComponent(path)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, sha }),
  }).then((r) => json<{ sha: string }>(r));
export const login = (password: string) =>
  fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then((r) => r.ok);
export const me = () => fetch('/api/me').then((r) => json<{ authed: boolean }>(r)).then((d) => d.authed);
export const askDb = (question: string) =>
  fetch('/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  }).then((r) => json<{ answer: string }>(r)).then((d) => d.answer);
export const triggerSync = () =>
  fetch('/api/sync', { method: 'POST' }).then((r) => json<{ synced: number }>(r)).then(() => undefined);
```

- [ ] **Step 6: Commit**

```bash
git add src/app/theme.css src/app/markdown.ts src/app/api.ts tests/markdown.test.ts
git commit -m "feat: 前端主題、markdown 渲染與 API client"
```

---

### Task 12: App 骨架、hash 路由、側欄與首頁

**Files:**
- Modify: `src/app/App.tsx`（整個替換）
- Create: `src/app/router.ts`, `src/app/components/Sidebar.tsx`, `src/app/pages/Home.tsx`
- Test: `tests/router.test.ts`

**Interfaces:**
- Produces:
  - `parseHash(hash: string): Route`，`type Route = {page: 'home'} | {page: 'article'; path: string} | {page: 'tag'; tag: string} | {page: 'db'}`
  - App 提供給子元件的 props：`index: SiteIndex`、`route: Route`、`dark: boolean`、`authed: boolean`、`go(hash: string): void`、`openSearch(): void`、`requireLogin(then: () => void): void`
  - Sidebar props：`{ index, route, dark, onToggleDark, onOpenSearch, currentPath?: string }`
  - Home props：`{ index }`

- [ ] **Step 1: 寫失敗測試（router 純函式）**

`tests/router.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseHash } from '../src/app/router';

describe('parseHash', () => {
  it('各路由解析', () => {
    expect(parseHash('')).toEqual({ page: 'home' });
    expect(parseHash('#/')).toEqual({ page: 'home' });
    expect(parseHash(`#/note/${encodeURIComponent('個人學習/a.md')}`)).toEqual({ page: 'article', path: '個人學習/a.md' });
    expect(parseHash('#/tag/mcp')).toEqual({ page: 'tag', tag: 'mcp' });
    expect(parseHash('#/db')).toEqual({ page: 'db' });
    expect(parseHash('#/unknown')).toEqual({ page: 'home' });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/router.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 router.ts**

```ts
export type Route =
  | { page: 'home' }
  | { page: 'article'; path: string }
  | { page: 'tag'; tag: string }
  | { page: 'db' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h.startsWith('/note/')) return { page: 'article', path: decodeURIComponent(h.slice('/note/'.length)) };
  if (h.startsWith('/tag/')) return { page: 'tag', tag: decodeURIComponent(h.slice('/tag/'.length)) };
  if (h === '/db') return { page: 'db' };
  return { page: 'home' };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/router.test.ts`
Expected: PASS

- [ ] **Step 5: 實作 App.tsx / Sidebar.tsx / Home.tsx**

`src/app/App.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './theme.css';
import { parseHash, type Route } from './router';
import { fetchIndex, me, login } from './api';
import type { SiteIndex } from '../shared/types';
import Sidebar from './components/Sidebar';
import SearchOverlay from './components/SearchOverlay';
import Home from './pages/Home';
import Article from './pages/Article';
import TagPage from './pages/TagPage';
import AskDb from './pages/AskDb';

const EMPTY: SiteIndex = { notes: [], builtAt: '' };

export default function App() {
  const [index, setIndex] = useState<SiteIndex>(EMPTY);
  const [route, setRoute] = useState<Route>(parseHash(location.hash));
  const [dark, setDark] = useState(localStorage.getItem('dark') === '1');
  const [authed, setAuthed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const reloadIndex = useCallback(() => { fetchIndex().then(setIndex).catch(() => {}); }, []);
  useEffect(() => { reloadIndex(); me().then(setAuthed).catch(() => {}); }, [reloadIndex]);
  useEffect(() => {
    const onHash = () => { setRoute(parseHash(location.hash)); mainRef.current?.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      else if (e.key === 'Escape') { setSearchOpen(false); setLoginOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { localStorage.setItem('dark', dark ? '1' : '0'); }, [dark]);

  const go = useCallback((hash: string) => { location.hash = hash; }, []);
  const requireLogin = useCallback((then: () => void) => {
    if (authed) then();
    else { pendingRef.current = then; setLoginOpen(true); setLoginError(false); setPassword(''); }
  }, [authed]);

  const doLogin = async () => {
    if (await login(password)) {
      setAuthed(true); setLoginOpen(false);
      pendingRef.current?.(); pendingRef.current = null;
    } else setLoginError(true);
  };

  const currentPath = route.page === 'article' ? route.path : undefined;
  const page = useMemo(() => {
    switch (route.page) {
      case 'article':
        return <Article key={route.path} path={route.path} index={index} authed={authed}
          requireLogin={requireLogin} onSaved={reloadIndex} />;
      case 'tag': return <TagPage tag={route.tag} index={index} />;
      case 'db': return <AskDb index={index} authed={authed} requireLogin={requireLogin} />;
      default: return <Home index={index} />;
    }
  }, [route, index, authed, requireLogin, reloadIndex]);

  return (
    <div data-dark={dark ? 'true' : 'false'} style={{ height: '100vh', display: 'grid', gridTemplateColumns: '280px 1fr', background: 'var(--bg)', color: 'var(--tx)', transition: 'background .25s', position: 'relative', overflow: 'hidden' }}>
      <Sidebar index={index} route={route} dark={dark} currentPath={currentPath}
        onToggleDark={() => setDark(!dark)} onOpenSearch={() => setSearchOpen(true)} />
      <div ref={mainRef} style={{ overflowY: 'auto', minHeight: 0 }}>{page}</div>
      {searchOpen && <SearchOverlay index={index} onClose={() => setSearchOpen(false)} />}
      {loginOpen && (
        <div onClick={() => setLoginOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(58,50,38,.28)', zIndex: 60, display: 'grid', placeItems: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 340, background: 'var(--bg)', border: '1px solid var(--ln)', borderRadius: 14, padding: '26px 28px', boxShadow: '0 24px 60px rgba(26,20,12,.35)' }}>
            <div style={{ font: "600 18px 'Noto Serif TC',serif", color: 'var(--hd)', marginBottom: 14 }}>登入</div>
            <input type="password" value={password} autoFocus placeholder="站台密碼"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doLogin()}
              style={{ width: '100%', border: '1px solid var(--ln)', borderRadius: 8, padding: '10px 12px', background: 'var(--pn)', color: 'var(--hd)', font: "15px 'Noto Sans TC',sans-serif", outline: 'none' }} />
            {loginError && <div style={{ color: 'var(--ac)', fontSize: 13, marginTop: 8 }}>密碼錯誤</div>}
            <div onClick={doLogin} style={{ marginTop: 16, textAlign: 'center', fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '9px 0', cursor: 'pointer' }}>登入</div>
          </div>
        </div>
      )}
    </div>
  );
}
```

`src/app/components/Sidebar.tsx`：

```tsx
import { useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import type { Route } from '../router';

export default function Sidebar({ index, route, dark, currentPath, onToggleDark, onOpenSearch }: {
  index: SiteIndex; route: Route; dark: boolean; currentPath?: string;
  onToggleDark: () => void; onOpenSearch: () => void;
}) {
  const folders = useMemo(() => {
    const map = new Map<string, typeof index.notes>();
    for (const n of index.notes) {
      if (!map.has(n.folder)) map.set(n.folder, []);
      map.get(n.folder)!.push(n);
    }
    return [...map.entries()];
  }, [index]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const current = currentPath ? index.notes.find((n) => n.path === currentPath) : undefined;
  const neighbors = current
    ? index.notes.filter((n) => current.linksTo.includes(n.path) || n.linksTo.includes(current.path)).slice(0, 5)
    : [];
  const label = { font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)' } as const;
  const positions = [[62, 30], [166, 38], [146, 82], [42, 70], [190, 78]];

  return (
    <div style={{ borderRight: '1px solid var(--ln)', padding: '28px 22px 22px', display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
      <div onClick={() => (location.hash = '#/')} style={{ font: "700 22px 'Noto Serif TC',serif", color: 'var(--hd)', cursor: 'pointer' }}>my-note</div>
      <div onClick={onOpenSearch} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 8, padding: '8px 12px', color: 'var(--mu)', fontSize: 13.5, cursor: 'pointer' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        搜尋<span style={{ marginLeft: 'auto', font: "11px 'IBM Plex Mono',monospace", background: 'var(--ci)', border: '1px solid var(--ln)', borderRadius: 4, padding: '1px 5px' }}>⌘K</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13.5, overflowY: 'auto' }}>
        <div style={{ ...label, marginBottom: 6 }}>總覽</div>
        {folders.map(([folder, notes]) => (
          <div key={folder}>
            <div onClick={() => setOpen((o) => ({ ...o, [folder]: !o[folder] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontWeight: open[folder] ? 500 : 400 }}>
              <span style={{ color: 'var(--mu)', fontSize: 10 }}>{open[folder] ? '▾' : '▸'}</span>{folder}
            </div>
            {open[folder] && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 13, borderLeft: '1px solid var(--ln)', paddingLeft: 10 }}>
                {notes.map((n) => {
                  const active = currentPath === n.path;
                  return (
                    <div key={n.path} onClick={() => (location.hash = `#/note/${encodeURIComponent(n.path)}`)}
                      style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: active ? 'var(--ab)' : undefined, color: active ? 'var(--ac)' : undefined, fontWeight: active ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.title}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <div onClick={() => (location.hash = '#/tag/')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', marginTop: 8 }}>
          <span style={{ color: 'var(--mu)', fontSize: 10 }}>#</span>標籤
        </div>
        <div onClick={() => (location.hash = '#/db')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: route.page === 'db' ? 'var(--ab)' : undefined, color: route.page === 'db' ? 'var(--ac)' : undefined, fontWeight: route.page === 'db' ? 500 : 400 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mu)" strokeWidth="2"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
          資料庫
        </div>
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {current && (
          <div>
            <div style={{ ...label, marginBottom: 8 }}>關聯圖</div>
            <div style={{ height: 110, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 8 }}>
              <svg width="100%" height="100%" viewBox="0 0 234 108">
                {neighbors.map((n, i) => (
                  <line key={n.path} x1="112" y1="54" x2={positions[i][0]} y2={positions[i][1]} stroke="var(--ln)" strokeWidth="1" />
                ))}
                <circle cx="112" cy="54" r="6" fill="var(--ac)" />
                {neighbors.map((n, i) => (
                  <circle key={n.path} cx={positions[i][0]} cy={positions[i][1]} r="4" fill={i % 3 === 2 ? 'var(--a2)' : 'var(--mu)'}
                    style={{ cursor: 'pointer' }} onClick={() => (location.hash = `#/note/${encodeURIComponent(n.path)}`)} />
                ))}
              </svg>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div onClick={onToggleDark} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--ln)', borderRadius: 20, padding: 4, background: 'var(--pn)', cursor: 'pointer' }}>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: dark ? 'transparent' : '#f6d36b88', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--hd)' }}>☀</span>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: dark ? 'rgba(236,149,102,.22)' : 'transparent', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--hd)' }}>☾</span>
          </div>
          <span style={{ font: "11px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>my-note</span>
        </div>
      </div>
    </div>
  );
}
```

`src/app/pages/Home.tsx`：

```tsx
import { useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';

export default function Home({ index }: { index: SiteIndex }) {
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const sections = useMemo(() => {
    const map = new Map<string, typeof index.notes>();
    for (const n of index.notes) {
      if (!map.has(n.folder)) map.set(n.folder, []);
      map.get(n.folder)!.push(n);
    }
    for (const list of map.values()) {
      list.sort((a, b) => sort === 'recent'
        ? (b.date ?? '').localeCompare(a.date ?? '')
        : a.title.localeCompare(b.title, 'zh-Hant'));
    }
    return [...map.entries()];
  }, [index, sort]);
  const pill = (active: boolean) => ({
    fontSize: 12.5, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
    background: active ? 'var(--ab)' : 'transparent', color: active ? 'var(--ac)' : 'inherit', fontWeight: active ? 500 : 400,
  } as const);
  return (
    <div style={{ padding: '64px 120px', maxWidth: 900 }}>
      <div style={{ font: "700 40px 'Noto Serif TC',serif", color: 'var(--hd)', marginBottom: 12 }}>my-note</div>
      <p style={{ margin: '0 0 26px', fontSize: 16, lineHeight: 1.9, maxWidth: 520 }}>
        學習筆記與作品集。整理自我的 Obsidian vault——涵蓋 LLM 學習、SRE 工具鏈與工作專案。
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 44, justifyContent: 'flex-end' }}>
        <span style={{ font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)' }}>排序</span>
        <div style={{ display: 'flex', border: '1px solid var(--ln)', borderRadius: 8, background: 'var(--pn)', padding: 3, gap: 2 }}>
          <span onClick={() => setSort('recent')} style={pill(sort === 'recent')}>最近編輯</span>
          <span onClick={() => setSort('name')} style={pill(sort === 'name')}>名稱</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
        {sections.map(([folder, notes]) => (
          <div key={folder}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '1px solid var(--ln)', paddingBottom: 8, marginBottom: 6 }}>
              <span style={{ font: "600 20px 'Noto Serif TC',serif", color: 'var(--hd)' }}>{folder}</span>
              <span style={{ font: "12px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{notes.length}</span>
            </div>
            {notes.map((n) => (
              <div key={n.path} onClick={() => (location.hash = `#/note/${encodeURIComponent(n.path)}`)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 2px', borderBottom: '1px solid var(--ls)', cursor: 'pointer' }}>
                <span style={{ fontSize: 15.5 }}>{n.title}</span>
                <span style={{ font: "12.5px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{n.date ?? ''}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

（此步驟 App.tsx 引用了 Task 13/14 的 Article/TagPage/AskDb/SearchOverlay——先建立**空殼檔案**讓編譯通過：每個檔 export default 一個回傳 `<div />` 的元件、props 型別照本任務 Interfaces 定義。Task 13/14 再填實作。）

- [ ] **Step 6: 驗證編譯**

Run: `npx tsc --noEmit && npm run build`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add src/app tests/router.test.ts
git commit -m "feat: App 骨架、hash 路由、側欄與首頁"
```

---

### Task 13: 文章頁與編輯模式

**Files:**
- Create: `src/app/pages/Article.tsx`（取代空殼）
- Test: 手動（`npm run dev` + `npm run dev:worker`）

**Interfaces:**
- Consumes: `fetchNote`、`saveNote`、`renderMarkdown`、`SiteIndex`
- Produces: `Article` props `{ path: string; index: SiteIndex; authed: boolean; requireLogin: (then: () => void) => void; onSaved: () => void }`

- [ ] **Step 1: 實作 Article.tsx（含閱讀與編輯兩態）**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { fetchNote, saveNote } from '../api';
import { renderMarkdown } from '../markdown';

export default function Article({ path, index, authed, requireLogin, onSaved }: {
  path: string; index: SiteIndex; authed: boolean;
  requireLogin: (then: () => void) => void; onSaved: () => void;
}) {
  const [note, setNote] = useState<{ content: string; sha: string } | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    setNote(null); setError(false); setEditing(false);
    fetchNote(path).then(setNote).catch(() => setError(true));
  }, [path]);

  const meta = index.notes.find((n) => n.path === path);
  const backlinks = index.notes.filter((n) => n.linksTo.includes(path));
  const titleToPath = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of index.notes) {
      m.set(n.title.toLowerCase(), n.path);
      m.set(n.path.split('/').pop()!.replace(/\.md$/, '').toLowerCase(), n.path);
    }
    return m;
  }, [index]);
  const rendered = useMemo(() =>
    note ? renderMarkdown(note.content, (t) => titleToPath.get(t.toLowerCase()) ?? null) : null,
  [note, titleToPath]);

  const startEdit = () => requireLogin(() => { setDraft(note!.content); setEditing(true); setJustSaved(false); setConflict(false); });
  const doSave = async () => {
    try {
      const r = await saveNote(path, draft, note!.sha);
      setNote({ content: draft, sha: r.sha });
      setEditing(false); setJustSaved(true); setConflict(false);
      onSaved();
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      if ((e as Error).message === 'conflict') setConflict(true);
      else alert('儲存失敗：' + (e as Error).message);
    }
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
      else if (e.key === 'Escape') setEditing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <div style={{ padding: 60, color: 'var(--mu)' }}>找不到這篇筆記。</div>;
  if (!note || !rendered) return <div style={{ padding: 60, color: 'var(--mu)' }}>載入中…</div>;
  const title = meta?.title ?? path.split('/').pop()!.replace(/\.md$/, '');

  if (editing) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--ln)', background: 'var(--pn)' }}>
          <span style={{ font: "11px 'IBM Plex Mono',monospace", letterSpacing: '.1em', color: 'var(--ac)', background: 'var(--ab)', borderRadius: 12, padding: '3px 10px' }}>編輯中</span>
          <span style={{ font: "600 16px 'Noto Serif TC',serif", color: 'var(--hd)' }}>{title}</span>
          <span style={{ font: "12px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{path}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span onClick={() => setEditing(false)} style={{ fontSize: 13.5, border: '1px solid var(--ln)', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', background: 'var(--bg)' }}>取消</span>
            <span onClick={doSave} style={{ fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '8px 18px', cursor: 'pointer' }}>儲存</span>
          </div>
        </div>
        {conflict && (
          <div style={{ padding: '10px 24px', background: 'var(--ab)', color: 'var(--ac)', fontSize: 13.5 }}>
            ⚠ 遠端已有新版本（sha 衝突）。請複製你的修改、重新整理頁面後再編輯。
          </div>
        )}
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
          style={{ flex: 1, minHeight: 0, resize: 'none', border: 'none', outline: 'none', background: 'var(--bg)', color: 'var(--tx)', padding: '28px 56px', font: "14px/2 'IBM Plex Mono',monospace" }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 24px', borderTop: '1px solid var(--ln)', font: "11.5px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>
          <span>Markdown</span><span>{draft.length} 字元</span><span style={{ marginLeft: 'auto' }}>⌘S 儲存 · Esc 取消</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '34px 316px 60px 56px', position: 'relative', maxWidth: 1400 }}>
      {rendered.toc.length > 0 && (
        <div style={{ position: 'fixed', right: 32, top: 34, width: 224, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 10, padding: '16px 18px', boxShadow: '0 4px 14px rgba(58,50,38,.06)' }}>
          <div style={{ font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)', marginBottom: 10 }}>目錄</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            {rendered.toc.map((h) => (
              <a key={h.id} href={`#/note/${encodeURIComponent(path)}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' }); }}
                style={{ paddingLeft: h.level === 3 ? 14 : 0, color: h.level === 3 ? 'var(--mu)' : 'var(--tx)', cursor: 'pointer', textDecoration: 'none' }}>
                {h.text}
              </a>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 13, color: 'var(--mu)', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
        <span onClick={() => (location.hash = '#/')} style={{ cursor: 'pointer' }}>首頁</span><span>/</span><span>{meta?.folder}</span>
      </div>
      <h1 style={{ font: "700 34px/1.3 'Noto Serif TC',serif", color: 'var(--hd)', margin: '0 0 14px' }}>{title}</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
        {meta?.date && <><span style={{ fontSize: 13, color: 'var(--mu)' }}>{meta.date}</span><span style={{ color: 'var(--ln)' }}>·</span></>}
        {meta?.tags.map((t) => (
          <span key={t} onClick={() => (location.hash = `#/tag/${encodeURIComponent(t)}`)}
            style={{ font: "12.5px 'IBM Plex Mono',monospace", color: 'var(--ac)', background: 'var(--ab)', borderRadius: 12, padding: '2px 10px', cursor: 'pointer' }}>#{t}</span>
        ))}
        <span onClick={startEdit} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--tx)', border: '1px solid var(--ln)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', background: 'var(--pn)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>編輯
        </span>
      </div>
      {justSaved && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--a2)', background: 'var(--ab)', borderRadius: 8, padding: '10px 14px', fontSize: 13.5, color: 'var(--ac)', marginBottom: 24 }}>✓ 已儲存變更並 commit 到 my-note</div>
      )}
      <div className="md-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      {backlinks.length > 0 && (
        <div style={{ borderTop: '1px solid var(--ln)', paddingTop: 24, marginTop: 40 }}>
          <div style={{ font: "500 12px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)', marginBottom: 14 }}>反向連結 · {backlinks.length}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {backlinks.map((b) => (
              <div key={b.path} onClick={() => (location.hash = `#/note/${encodeURIComponent(b.path)}`)}
                style={{ width: 300, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 10, padding: '16px 18px', cursor: 'pointer' }}>
                <div style={{ font: "600 15px 'Noto Serif TC',serif", color: 'var(--hd)', marginBottom: 6 }}>{b.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--mu)' }}>{b.excerpt.slice(0, 60)}…</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 編譯與全測試**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0、全 PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/pages/Article.tsx
git commit -m "feat: 文章頁與編輯模式"
```

---

### Task 14: 標籤頁、搜尋 overlay、問資料庫頁

**Files:**
- Create: `src/app/pages/TagPage.tsx`, `src/app/components/SearchOverlay.tsx`, `src/app/pages/AskDb.tsx`（取代空殼）

**Interfaces:**
- Consumes: `SiteIndex`、`askDb`
- Produces: `TagPage` props `{ tag: string; index: SiteIndex }`（tag 為空字串時顯示全部標籤）；`SearchOverlay` props `{ index: SiteIndex; onClose: () => void }`；`AskDb` props `{ index: SiteIndex; authed: boolean; requireLogin: (then: () => void) => void }`

- [ ] **Step 1: TagPage.tsx**

```tsx
import { useMemo } from 'react';
import type { SiteIndex } from '../../shared/types';

export default function TagPage({ tag, index }: { tag: string; index: SiteIndex }) {
  const allTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of index.notes) for (const t of n.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [index]);
  const matched = tag ? index.notes.filter((n) => n.tags.includes(tag)) : [];
  return (
    <div style={{ padding: '52px 80px', maxWidth: 760 }}>
      <div style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 14 }}>
        <span onClick={() => (location.hash = '#/')} style={{ cursor: 'pointer' }}>首頁</span> / 標籤
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={{ font: "700 32px 'Noto Serif TC',serif", color: 'var(--hd)' }}>
          標籤{tag && <>：<span style={{ color: 'var(--ac)' }}>#{tag}</span></>}
        </span>
        {tag && <span style={{ font: "13px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{matched.length} 篇</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 34, flexWrap: 'wrap' }}>
        {allTags.map(([t]) => (
          <span key={t} onClick={() => (location.hash = `#/tag/${encodeURIComponent(t)}`)}
            style={t === tag
              ? { font: "12.5px 'IBM Plex Mono',monospace", color: 'var(--ac)', background: 'var(--ab)', borderRadius: 12, padding: '3px 12px', cursor: 'pointer' }
              : { font: "12.5px 'IBM Plex Mono',monospace", border: '1px solid var(--ln)', borderRadius: 12, padding: '3px 12px', cursor: 'pointer' }}>
            #{t}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {matched.map((n) => (
          <div key={n.path} onClick={() => (location.hash = `#/note/${encodeURIComponent(n.path)}`)}
            style={{ background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 10, padding: '18px 22px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ font: "600 17px 'Noto Serif TC',serif", color: 'var(--hd)' }}>{n.title}</span>
              <span style={{ font: "12px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{n.date ?? ''}</span>
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.9, marginTop: 6 }}>{n.excerpt.slice(0, 80)}…</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: SearchOverlay.tsx**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SiteIndex } from '../../shared/types';

function highlight(text: string, q: string) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (<>{text.slice(0, i)}<mark style={{ background: 'var(--hl)', color: 'var(--hd)', borderRadius: 2, padding: '0 1px' }}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>);
}

export default function SearchOverlay({ index, onClose }: { index: SiteIndex; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index.notes.slice(0, 8);
    return index.notes.filter((n) =>
      n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))).slice(0, 8);
  }, [index, query]);
  const sel = results[Math.min(selected, results.length - 1)];
  const open = (path: string) => { location.hash = `#/note/${encodeURIComponent(path)}`; onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && sel) open(sel.path);
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(58,50,38,.28)', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: '50%', top: 56, transform: 'translateX(-50%)', width: 720, maxWidth: '90%', background: 'var(--bg)', border: '1px solid var(--ln)', borderRadius: 14, boxShadow: '0 24px 60px rgba(26,20,12,.35)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSelected(0); }} onKeyDown={onKey}
            placeholder="搜尋筆記…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', font: "17px 'Noto Sans TC',sans-serif", color: 'var(--hd)' }} />
          <span onClick={onClose} style={{ font: "11px 'IBM Plex Mono',monospace", color: 'var(--mu)', border: '1px solid var(--ln)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}>ESC</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: 340 }}>
          <div style={{ borderRight: '1px solid var(--ln)', padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.map((n, i) => (
              <div key={n.path} onClick={() => open(n.path)} onMouseEnter={() => setSelected(i)}
                style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: i === selected ? 'var(--ab)' : undefined }}>
                <div style={{ font: "600 14px 'Noto Serif TC',serif", color: i === selected ? 'var(--ac)' : 'var(--hd)' }}>
                  {highlight(n.title, query.trim())}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 3 }}>{n.folder}</div>
              </div>
            ))}
            {results.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'var(--mu)' }}>沒有符合的筆記</div>}
          </div>
          <div style={{ padding: '18px 22px' }}>
            {sel && (<>
              <div style={{ font: "600 16px 'Noto Serif TC',serif", color: 'var(--hd)', marginBottom: 10 }}>{sel.title}</div>
              <div style={{ fontSize: 13.5, lineHeight: 2 }}>{highlight(sel.excerpt, query.trim())}</div>
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--mu)' }}>↑↓ 選擇 · Enter 開啟</div>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: AskDb.tsx**

```tsx
import { useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { askDb } from '../api';

interface Msg { id: number; q: string; a: string; pending: boolean }
const SAMPLES = ['notebooklm 要怎麼重新登入？', '目前啟用了哪些 MCP server？', '改了 opencode.json 之後要做什麼？'];

export default function AskDb({ index, authed, requireLogin }: {
  index: SiteIndex; authed: boolean; requireLogin: (then: () => void) => void;
}) {
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<Msg[]>([]);
  const [asking, setAsking] = useState(false);

  const send = (text?: string) => {
    const q = (text ?? question).trim();
    if (!q || asking) return;
    requireLogin(async () => {
      const id = Date.now();
      setQuestion(''); setAsking(true);
      setChat((c) => [...c, { id, q, a: '', pending: true }]);
      let a: string;
      try { a = await askDb(q); } catch { a = '查詢失敗，請再試一次。'; }
      setChat((c) => c.map((m) => (m.id === id ? { ...m, a, pending: false } : m)));
      setAsking(false);
    });
  };

  return (
    <div style={{ padding: '52px 80px', maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 14 }}>
        <span onClick={() => (location.hash = '#/')} style={{ cursor: 'pointer' }}>首頁</span> / 資料庫
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={{ font: "700 32px 'Noto Serif TC',serif", color: 'var(--hd)' }}>問資料庫</span>
        <span style={{ font: "13px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{index.notes.length} 篇筆記</span>
      </div>
      <p style={{ margin: '0 0 24px', fontSize: 14.5, lineHeight: 1.9, color: 'var(--mu)' }}>
        輸入問題，Agent 會根據筆記資料庫的內容回覆。{!authed && '（需要登入）'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 10, padding: '6px 6px 6px 16px', marginBottom: 28 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z" /></svg>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="例如：notebooklm 要怎麼重新登入？"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', font: "15px 'Noto Sans TC',sans-serif", color: 'var(--hd)' }} />
        <span onClick={() => send()} style={{ fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', whiteSpace: 'nowrap' }}>送出</span>
      </div>
      {chat.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)' }}>試試這些問題</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SAMPLES.map((s) => (
              <span key={s} onClick={() => send(s)}
                style={{ fontSize: 13.5, border: '1px solid var(--ln)', background: 'var(--pn)', borderRadius: 18, padding: '7px 16px', cursor: 'pointer' }}>{s}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {chat.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '75%', background: 'var(--ab)', color: 'var(--hd)', borderRadius: '12px 12px 2px 12px', padding: '10px 16px', fontSize: 14.5, lineHeight: 1.8 }}>{m.q}</div>
            <div style={{ background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: '2px 12px 12px 12px', padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: '.1em', color: 'var(--ac)' }}>AGENT</span>
                <span style={{ font: "11px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{m.pending ? '檢索資料庫中…' : '已根據資料庫回覆'}</span>
              </div>
              {m.pending
                ? <div style={{ fontSize: 14, color: 'var(--mu)' }}>思考中…</div>
                : <div style={{ fontSize: 14.5, lineHeight: 2, whiteSpace: 'pre-wrap' }}>{m.a}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 編譯與全測試**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat: 標籤頁、搜尋 overlay 與問資料庫頁"
```

---

### Task 15: 本機端對端驗證與部署文件

**Files:**
- Create: `README.md`
- Modify: `wrangler.jsonc`（部署時換真 KV id——此步由使用者提供 Cloudflare 帳號後執行）

**Interfaces:**
- Consumes: 全部前述任務。

- [ ] **Step 1: 本機端對端驗證（開兩個終端）**

Run（終端 1）: `npx wrangler dev`（本機 KV，AI binding 需 `wrangler login` 後可用）
Run（終端 2）: `npm run dev`
以瀏覽器開 vite 網址驗證：
1. 首頁載入（索引為空時顯示空清單——正常，尚未同步）。
2. 用 curl 塞測試資料驗證 API：
   ```bash
   curl -s http://127.0.0.1:8787/api/health   # {"ok":true}
   ```
3. `wrangler dev` 本機沒有真 GITHUB_TOKEN 時，在 `.dev.vars` 放入測試值：
   ```
   SITE_PASSWORD=devpw
   SESSION_SECRET=devsecret
   WEBHOOK_SECRET=devwh
   GITHUB_TOKEN=<你的 PAT，或留空僅測閱讀>
   ```
   （`.dev.vars` 加入 `.gitignore`。）
4. 有 PAT 時：登入 → 開發者工具 `fetch('/api/sync',{method:'POST'})` → 首頁出現筆記 → 點文章 → 編輯 → 儲存 → 到 GitHub 確認 commit。

- [ ] **Step 2: 寫 README.md**

內容需包含（實際撰寫，不留空節）：
- 專案簡介與架構圖（照 spec 第 3 節）。
- 本機開發：`npm i`、`.dev.vars` 設定、`npx wrangler dev` + `npm run dev`。
- 部署步驟：
  1. `npx wrangler kv namespace create NOTES` → 把 id 填入 `wrangler.jsonc`。
  2. `npx wrangler secret put SITE_PASSWORD`（同法設 SESSION_SECRET、WEBHOOK_SECRET、GITHUB_TOKEN）。
  3. `npm run deploy`。
  4. GitHub my-note → Settings → Webhooks → Add：Payload URL `https://<worker 網址>/api/webhook`、Content type `application/json`、Secret 同 WEBHOOK_SECRET、只選 push 事件。
  5. GitHub → Settings → Developer settings → Fine-grained token：只授權 hsjinde/my-note、Contents Read and write。
  6. 開網站 → 登入 → 問資料庫頁前先執行一次全量同步（curl 或 console `fetch('/api/sync',{method:'POST'})`）。
- 驗收清單：push my-note 後幾秒內首頁更新；網頁編輯後 my-note 出現 `docs: 網頁編輯「…」` commit；問資料庫能根據筆記回答。

- [ ] **Step 3: 全部測試最後跑一次**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 全綠

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: README 與部署說明"
```

---

## 驗收對照（spec → task）

| Spec 需求 | Task |
|---|---|
| 白名單/wiki 過濾 | 2, 3, 8 |
| 索引（樹/標籤/backlinks/搜尋資料） | 3 |
| webhook 增量同步 | 5, 7, 9 |
| 全量同步 | 7, 9 |
| 編輯回寫 commit + sha 衝突 | 6, 9, 13 |
| 密碼登入 + cookie | 4, 9, 12 |
| AI 問答（含 wiki、需登入） | 10, 14 |
| 原型 UI（7 區塊） | 11–14 |
| 部署與 webhook/PAT 設定 | 15 |
