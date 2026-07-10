# 新增筆記功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓站主在網站上選公開資料夾＋填標題建立一篇空白 `.md` 筆記，commit 回 `hsjinde/my-note`，並自動進入該篇的編輯畫面。

**Architecture:** 新增專用後端端點 `POST /api/note` 負責「建立」（驗證＋不存在檢查＋`putFile`＋回寫 KV／重建索引），與既有 `POST /api/quicknote` 風格一致。前端在側欄放入口按鈕，App 層開彈窗（沿用登入 modal 樣式）收集資料夾＋標題，建立成功後導頁 `#/note/<path>?edit=1`，由 `Article.tsx` 偵測旗標自動進編輯。公開資料夾白名單抽到 `src/shared/folders.ts` 供前後端共用，避免重複定義。

**Tech Stack:** React + Vite（前端 SPA）、Hono（Cloudflare Worker）、Cloudflare KV、Vitest。TypeScript 全程。

## Global Constraints

- 顏色一律走 `src/app/theme.css` 的 CSS 變數，且亮暗雙版都要給值。
- 書籤橘 `--ac` 覆蓋率 ≤10%：新增按鈕用邊框式（`border: 1px solid var(--ln)` + `var(--pn)` 底），不用橘底。
- 新介面要在 375px 手機視窗驗證過才算完成。
- 初始筆記內容固定為 `` `---\ntitle: <標題>\n---\n\n` ``（只有 title frontmatter，結尾一個空行）。
- commit message 固定為 `` `docs: 新增「<標題>」` ``。
- 標題非法字元集：`/ \ : * ? " < > |`（正則 `/[/\\:*?"<>|]/`）。
- 公開資料夾白名單：`個人學習`、`好工具推薦`、`工作專案`、`靈感`。

---

### Task 1: 抽出共用資料夾白名單 `src/shared/folders.ts`

把 `PUBLIC_FOLDERS` 移到前後端共用的 shared 模組，讓前端彈窗與後端驗證共用同一份白名單，且不必把 worker 的 `yaml` 相依拉進前端 bundle。純重構，既有測試須全綠。

**Files:**
- Create: `src/shared/folders.ts`
- Modify: `src/worker/content.ts:1-5`
- Test: 沿用既有 `tests/*`（不新增測試，靠回歸驗證）

**Interfaces:**
- Produces: `export const PUBLIC_FOLDERS: string[]`（值 `['個人學習', '好工具推薦', '工作專案', '靈感']`），供 Task 2 後端與 Task 4 前端 import。

- [ ] **Step 1: 建立 shared 模組**

建立 `src/shared/folders.ts`：

```ts
// 公開閱讀 + 可寫回的資料夾白名單，前後端共用（避免重複定義）。
export const PUBLIC_FOLDERS = ['個人學習', '好工具推薦', '工作專案', '靈感'];
```

- [ ] **Step 2: content.ts 改為 import**

修改 `src/worker/content.ts` 開頭。把原本的 `export const PUBLIC_FOLDERS = [...]` 那一行（第 4 行）刪掉，改成從 shared 匯入並 re-export（保持對外 API 不變）：

原本：
```ts
import { parse as parseYaml } from 'yaml';
import type { NoteMeta, SiteIndex } from '../shared/types';

export const PUBLIC_FOLDERS = ['個人學習', '好工具推薦', '工作專案', '靈感'];
export const AI_EXTRA_FOLDERS = ['wiki'];
```

改為：
```ts
import { parse as parseYaml } from 'yaml';
import type { NoteMeta, SiteIndex } from '../shared/types';
import { PUBLIC_FOLDERS } from '../shared/folders';

export { PUBLIC_FOLDERS };
export const AI_EXTRA_FOLDERS = ['wiki'];
```

- [ ] **Step 3: 跑既有測試與型別檢查確認沒破壞**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS，`tsc` 無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/shared/folders.ts src/worker/content.ts
git commit -m "refactor: 抽出 PUBLIC_FOLDERS 至 src/shared 供前後端共用"
```

---

### Task 2: 後端 `POST /api/note` 建立筆記

新增建立端點：驗證標題與路徑、檢查不存在、`putFile` 建立空白筆記、回寫 KV shard 並重建索引。

**Files:**
- Modify: `src/worker/index.ts`（在 `POST /api/quicknote` 之後、`POST /api/sync` 之前加入新路由）
- Test: `tests/create-note.test.ts`（新建）

**Interfaces:**
- Consumes: `isPublicPath`（`./content`）、`shardKey` / `rebuildIndexFromKV`（`./sync`）、`GitHub` / `ShaConflictError`（`./github`）、`requireAuth` / `github(env)`（同檔既有）。這些皆已在 `src/worker/index.ts` import 或定義。
- Produces: `POST /api/note`，body `{ folder: string; title: string }`，成功回 `{ path: string; sha: string }`（200）；錯誤 `400`（`empty title` / `invalid title` / `invalid path`）、`401`（未登入）、`409`（`already exists`）。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/create-note.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/worker/index';
import { mockKV } from './helpers';
import { createSession } from '../src/worker/auth';

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
const post = async (body: unknown, e = env()) =>
  app.request('/api/note', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(await authedHeaders()) },
  }, e);

// GitHub getFile(不存在 → 404) + putFile(建立 → 回 sha) 的 mock
function mockGithubCreate() {
  const captured: { message?: string; content?: string; path?: string } = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/contents/') && (!init || init.method === undefined)) {
      return new Response('not found', { status: 404 }); // getFile → 不存在
    }
    const b = JSON.parse(String(init?.body));
    captured.message = b.message; captured.content = b.content;
    captured.path = decodeURIComponent(u.split('/contents/')[1]);
    return Response.json({ content: { sha: 'new1' } });
  }));
  return captured;
}

describe('POST /api/note', () => {
  it('未登入 401', async () => {
    const res = await app.request('/api/note', {
      method: 'POST', body: JSON.stringify({ folder: '個人學習', title: '新筆記' }),
      headers: { 'Content-Type': 'application/json' },
    }, env());
    expect(res.status).toBe(401);
  });

  it('空白標題 400', async () => {
    const res = await post({ folder: '個人學習', title: '   ' });
    expect(res.status).toBe(400);
  });

  it('標題含非法字元 400', async () => {
    const res = await post({ folder: '個人學習', title: 'a/b' });
    expect(res.status).toBe(400);
  });

  it('非白名單資料夾 400', async () => {
    const res = await post({ folder: 'wiki', title: '祕密' });
    expect(res.status).toBe(400);
  });

  it('KV 已有同名筆記 → 409', async () => {
    const e = env({
      'shard:個人學習': JSON.stringify({ '個人學習/新筆記.md': { content: 'x', sha: 's' } }),
    });
    const res = await post({ folder: '個人學習', title: '新筆記' }, e);
    expect(res.status).toBe(409);
  });

  it('GitHub 已有同名筆記（KV 沒有）→ 409', async () => {
    // getFile 回 200（檔案存在），不應進到 putFile
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/contents/') && (!init || init.method === undefined)) {
        return Response.json({ content: btoa('existing'), sha: 'exist' });
      }
      throw new Error('should not putFile when file exists');
    }));
    const res = await post({ folder: '個人學習', title: '新筆記' });
    expect(res.status).toBe(409);
  });

  it('成功建立：commit 到 GitHub、寫入 KV、索引含新筆記，回傳 path 與 sha', async () => {
    const captured = mockGithubCreate();
    const e = env();
    const res = await post({ folder: '個人學習', title: '新筆記' }, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: '個人學習/新筆記.md', sha: 'new1' });
    expect(captured.message).toBe('docs: 新增「新筆記」');
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(captured.content!.replace(/\n/g, '')), (ch) => ch.charCodeAt(0)));
    expect(decoded).toBe('---\ntitle: 新筆記\n---\n\n');
    const kv = (e as { NOTES: { get: (k: string, t: string) => Promise<unknown> } }).NOTES;
    expect(await kv.get('shard:個人學習', 'json')).toEqual({
      '個人學習/新筆記.md': { content: '---\ntitle: 新筆記\n---\n\n', sha: 'new1' },
    });
    const idx = await kv.get('meta:index', 'json') as { notes: { path: string }[] };
    expect(idx.notes.some((n) => n.path === '個人學習/新筆記.md')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/create-note.test.ts`
Expected: FAIL（`/api/note` 尚未存在，多數案例回 404 而非預期狀態碼）。

- [ ] **Step 3: 實作端點**

在 `src/worker/index.ts` 的 `POST /api/quicknote` 區塊之後、`POST /api/sync` 之前插入：

```ts
app.post('/api/note', requireAuth, async (c) => {
  const { folder, title } = await c.req.json<{ folder: string; title: string }>();
  const t = title?.trim();
  if (!t) return c.json({ error: 'empty title' }, 400);
  if (/[/\\:*?"<>|]/.test(t)) return c.json({ error: 'invalid title' }, 400);
  const path = `${folder}/${t}.md`;
  if (!isPublicPath(path)) return c.json({ error: 'invalid path' }, 400);

  const key = shardKey(path);
  const shard = ((await c.env.NOTES.get(key, 'json')) as Record<string, { content: string; sha: string }> | null) ?? {};
  if (shard[path]) return c.json({ error: 'already exists' }, 409);

  const gh = github(c.env);
  if (await gh.getFile(path)) return c.json({ error: 'already exists' }, 409);

  const content = `---\ntitle: ${t}\n---\n\n`;
  try {
    const result = await gh.putFile(path, content, `docs: 新增「${t}」`);
    shard[path] = { content, sha: result.sha };
    await c.env.NOTES.put(key, JSON.stringify(shard));
    await rebuildIndexFromKV(c.env.NOTES);
    return c.json({ path, sha: result.sha });
  } catch (e) {
    if (e instanceof ShaConflictError) return c.json({ error: 'already exists' }, 409);
    throw e;
  }
});
```

（`isPublicPath` 已在檔案頂部 `import { isPublicPath, publicIndex, parseNote } from './content'` 匯入；`shardKey`、`rebuildIndexFromKV` 已從 `./sync` 匯入；`ShaConflictError` 已從 `./github` 匯入。無需新增 import。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/create-note.test.ts`
Expected: PASS（7 個案例全綠）。

- [ ] **Step 5: 全套回歸 + 型別檢查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/worker/index.ts tests/create-note.test.ts
git commit -m "feat(api): 新增 POST /api/note 建立空白筆記"
```

---

### Task 3: API 客戶端 `postNote`

前端呼叫建立端點的函式。

**Files:**
- Modify: `src/app/api.ts`（在檔案結尾 `postQuicknote` 之後新增）

**Interfaces:**
- Consumes: 同檔既有 `json<T>(res)` 錯誤映射（401→`unauthorized`、409→`conflict`）。
- Produces: `postNote(folder: string, title: string): Promise<{ path: string; sha: string }>`，供 Task 4 使用。

- [ ] **Step 1: 新增 postNote**

在 `src/app/api.ts` 結尾（`postQuicknote` 之後）加入：

```ts
export const postNote = (folder: string, title: string) =>
  fetch('/api/note', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, title }),
  }).then((r) => json<{ path: string; sha: string }>(r));
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/app/api.ts
git commit -m "feat(api-client): 新增 postNote"
```

---

### Task 4: 前端側欄入口 + App 新增彈窗

側欄放「＋ 新增筆記」按鈕（走 `requireLogin`），App 層開彈窗收集資料夾＋標題，建立成功後導頁到編輯。

**Files:**
- Modify: `src/app/components/Sidebar.tsx`（新增 prop `onNewNote` 與按鈕）
- Modify: `src/app/App.tsx`（新增彈窗狀態、UI、傳 `onNewNote` 給 Sidebar）

**Interfaces:**
- Consumes: `postNote`（Task 3）、`PUBLIC_FOLDERS`（`../../shared/folders` / `../shared/folders`）、既有 `requireLogin` / `reloadIndex`。
- Produces: Sidebar 新增 prop `onNewNote: () => void`（App 傳入，內容為 `requireLogin(() => setNewNoteOpen(true))`）。

- [ ] **Step 1: Sidebar 新增按鈕與 prop**

在 `src/app/components/Sidebar.tsx`：

(a) 在 props 型別加入 `onNewNote: () => void`。找到：

```tsx
  index: SiteIndex; route: Route; dark: boolean; currentPath?: string; open: boolean;
  requireLogin: (then: () => void) => void;
  onToggleDark: () => void; onOpenSearch: () => void; onQuicknoteSaved: () => void;
```

改為（新增 `onNewNote`）：

```tsx
  index: SiteIndex; route: Route; dark: boolean; currentPath?: string; open: boolean;
  requireLogin: (then: () => void) => void;
  onToggleDark: () => void; onOpenSearch: () => void; onQuicknoteSaved: () => void;
  onNewNote: () => void;
```

並在解構參數加入 `onNewNote`。找到：

```tsx
  index, route, dark, currentPath, open: drawerOpen, requireLogin,
  onToggleDark, onOpenSearch, onQuicknoteSaved,
}: {
```

改為：

```tsx
  index, route, dark, currentPath, open: drawerOpen, requireLogin,
  onToggleDark, onOpenSearch, onQuicknoteSaved, onNewNote,
}: {
```

(b) 在「資料庫」連結（`href="#/db"` 的 `<a>`）之後、`<div style={{ marginTop: 8 }}>`（靈感區）之前，插入按鈕：

```tsx
        <button className="btn-reset" onClick={onNewNote}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--ln)', background: 'var(--pn)', color: 'var(--tx)', font: "13px 'Noto Sans TC',sans-serif", width: '100%' }}>
          <span aria-hidden="true" style={{ color: 'var(--mu)', fontSize: 14, lineHeight: 1 }}>＋</span>新增筆記
        </button>
```

- [ ] **Step 2: App 新增彈窗狀態與 UI**

在 `src/app/App.tsx`：

(a) 匯入。找到：

```tsx
import { fetchIndex, me, login } from './api';
```

改為：

```tsx
import { fetchIndex, me, login, postNote } from './api';
import { PUBLIC_FOLDERS } from '../shared/folders';
```

(b) 新增 state（放在既有 `const [loginError, setLoginError] = useState(false);` 之後）：

```tsx
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newFolder, setNewFolder] = useState(PUBLIC_FOLDERS[0]);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
```

(c) 新增建立處理函式（放在 `doLogin` 之後）：

```tsx
  const openNewNote = () => {
    setNewFolder(PUBLIC_FOLDERS[0]); setNewTitle(''); setCreateError(''); setNewNoteOpen(true);
  };
  const doCreateNote = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    if (/[/\\:*?"<>|]/.test(title)) { setCreateError('標題不能包含 / \\ : * ? " < > |'); return; }
    setCreating(true); setCreateError('');
    try {
      const { path } = await postNote(newFolder, title);
      reloadIndex();
      setNewNoteOpen(false);
      location.hash = `#/note/${encodeURIComponent(path)}?edit=1`;
    } catch (e) {
      setCreateError((e as Error).message === 'conflict' ? '這篇筆記已經存在' : '建立失敗，請再試一次');
    } finally {
      setCreating(false);
    }
  };
```

(d) 傳 `onNewNote` 給 Sidebar。找到：

```tsx
      <Sidebar index={index} route={route} dark={dark} currentPath={currentPath} open={sidebarOpen}
        requireLogin={requireLogin}
        onToggleDark={() => setDark(!dark)} onOpenSearch={() => setSearchOpen(true)} onQuicknoteSaved={reloadIndex} />
```

改為（新增 `onNewNote`）：

```tsx
      <Sidebar index={index} route={route} dark={dark} currentPath={currentPath} open={sidebarOpen}
        requireLogin={requireLogin} onNewNote={() => requireLogin(openNewNote)}
        onToggleDark={() => setDark(!dark)} onOpenSearch={() => setSearchOpen(true)} onQuicknoteSaved={reloadIndex} />
```

(e) 在既有登入 modal 的 `{loginOpen && ( ... )}` 區塊之後、`</div>`(app-shell 收尾) 之前，插入彈窗：

```tsx
      {newNoteOpen && (
        <div onClick={() => setNewNoteOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(58,50,38,.28)', zIndex: 60, display: 'grid', placeItems: 'center' }}>
          <div role="dialog" aria-modal="true" aria-label="新增筆記" onClick={(e) => e.stopPropagation()} style={{ width: 'min(380px, 90vw)', background: 'var(--bg)', border: '1px solid var(--ln)', borderRadius: 14, padding: '26px 28px', boxShadow: '0 24px 60px rgba(26,20,12,.35)' }}>
            <div style={{ font: "600 18px 'Noto Serif TC',serif", color: 'var(--hd)', marginBottom: 14 }}>新增筆記</div>
            <label style={{ display: 'block', font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)', marginBottom: 6 }}>資料夾</label>
            <select value={newFolder} onChange={(e) => setNewFolder(e.target.value)} aria-label="資料夾"
              style={{ width: '100%', border: '1px solid var(--ln)', borderRadius: 8, padding: '9px 12px', background: 'var(--pn)', color: 'var(--hd)', font: "14px 'Noto Sans TC',sans-serif", marginBottom: 14 }}>
              {PUBLIC_FOLDERS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <label style={{ display: 'block', font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)', marginBottom: 6 }}>標題</label>
            <input value={newTitle} autoFocus placeholder="筆記標題" aria-label="標題"
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doCreateNote()}
              style={{ width: '100%', border: '1px solid var(--ln)', borderRadius: 8, padding: '10px 12px', background: 'var(--pn)', color: 'var(--hd)', font: "15px 'Noto Sans TC',sans-serif" }} />
            <div style={{ font: "12px 'IBM Plex Mono',monospace", color: 'var(--mu)', marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {newFolder}/{newTitle.trim() || '標題'}.md
            </div>
            {createError && <div role="alert" style={{ color: 'var(--ac)', fontSize: 13, marginTop: 8 }}>{createError}</div>}
            <button className="btn-reset" onClick={doCreateNote} disabled={creating || !newTitle.trim()}
              style={{ marginTop: 16, width: '100%', textAlign: 'center', fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '10px 0', opacity: creating || !newTitle.trim() ? 0.6 : 1, cursor: creating ? 'wait' : 'pointer' }}>
              {creating ? '建立中…' : '建立並編輯'}
            </button>
          </div>
        </div>
      )}
```

(f) Esc 關閉：找到既有 keydown effect 內的：

```tsx
      else if (e.key === 'Escape') { setSearchOpen(false); setLoginOpen(false); }
```

改為：

```tsx
      else if (e.key === 'Escape') { setSearchOpen(false); setLoginOpen(false); setNewNoteOpen(false); }
```

- [ ] **Step 3: 型別檢查 + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 無錯誤，build 成功。

- [ ] **Step 4: 手動驗證（含 375px）**

啟動 `npx wrangler dev` 與 `npm run dev`，瀏覽器開 `http://localhost:5173`：
- 未登入點「＋ 新增筆記」→ 跳登入彈窗。
- 登入後點按鈕 → 新增彈窗出現，資料夾下拉有四個選項，路徑預覽即時更新。
- 標題含 `/` → 顯示非法字元提示、不送出。
- 用 375px 視窗（DevTools 裝置模擬）確認彈窗與側欄按鈕排版正常、可操作。

（實際建立成功導頁到編輯的行為，於 Task 5 完成後一起驗證。）

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx src/app/components/Sidebar.tsx
git commit -m "feat(ui): 側欄新增筆記入口與 App 建立彈窗"
```

---

### Task 5: 建立後自動進入編輯（Article `?edit=1`）

`Article.tsx` 偵測 `#/note/<path>?edit=1`，note 載入後自動進編輯並清掉旗標。

**Files:**
- Modify: `src/app/pages/Article.tsx`

**Interfaces:**
- Consumes: 同檔既有 `startEdit`、`note` state、`path` prop。
- Produces: 無新對外介面（行為變更）。

- [ ] **Step 1: 新增自動進編輯 effect**

在 `src/app/pages/Article.tsx` 中，於既有「Honor a shared deep link」的 `useEffect`（依賴 `[rendered, path]` 的那個）之後，新增：

```tsx
  // 由「新增筆記」導來的 #/note/<path>?edit=1：載入後自動進入編輯，並清掉旗標避免重整／返回時重觸發。
  useEffect(() => {
    if (!note || editing) return;
    if (!/[?&]edit=1(?:&|$)/.test(location.hash)) return;
    startEdit();
    history.replaceState(null, '', `#/note/${encodeURIComponent(path)}`);
  }, [note, editing, path]);
```

註：`startEdit` 內部呼叫 `requireLogin`，此情境使用者剛建立（已登入），會直接放行；未登入時 `requireLogin` 會跳登入彈窗，行為安全。

- [ ] **Step 2: 型別檢查 + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 無錯誤，build 成功。

- [ ] **Step 3: 端到端手動驗證**

啟動 `npx wrangler dev` 與 `npm run dev`（需設定好 `.dev.vars` 的 `GITHUB_TOKEN` 才能真的 commit；或用一個測試 repo）：
- 登入 → 「＋ 新增筆記」→ 選資料夾、填標題「測試新增」→ 建立。
- 預期：導頁到 `#/note/<資料夾>/測試新增.md`，**自動進入編輯畫面**，網址列 `?edit=1` 已消失，內容為 `---\ntitle: 測試新增\n---`。
- 重整該頁 → 不應再自動進編輯。
- 側欄樹該資料夾下出現「測試新增」。
- 對同一資料夾＋標題再建一次 → 彈窗顯示「這篇筆記已經存在」。
- 375px 視窗再走一次流程確認排版與可操作性。

- [ ] **Step 4: 全套回歸**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全部 PASS / 成功。

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/Article.tsx
git commit -m "feat(article): 由新增筆記導入時自動進入編輯"
```

---

## Self-Review

**Spec coverage：**
- 存放規則（選資料夾＋標題、路徑組成、初始內容）→ Task 2（後端組 path 與 content）、Task 4（前端下拉＋標題）。✅
- `POST /api/note` 全流程（驗證、409、putFile、KV、索引）→ Task 2。✅
- 側欄入口（邊框式、requireLogin）→ Task 4 Step 1。✅
- App 彈窗（沿用登入 modal 樣式、下拉、路徑預覽、錯誤、建立中 disable）→ Task 4 Step 2。✅
- 建立成功導頁 `?edit=1` → Task 4（設 hash）＋ Task 5（自動進編輯）。✅
- api 客戶端 `postNote` → Task 3。✅
- 白名單共用不重複 → Task 1。✅
- 測試 `tests/create-note.test.ts`（空白／非法／非白名單／同名 409／成功建立含索引）→ Task 2 Step 1。✅
- 硬規則（CSS 變數亮暗、`--ac` ≤10% 用邊框按鈕、375px 驗證）→ Global Constraints + Task 4/5 手動驗證步驟。✅

**Placeholder scan：** 無 TBD/TODO；所有程式碼步驟均含完整程式碼。✅

**Type consistency：** `postNote(folder, title) → { path, sha }` 在 Task 3 定義、Task 4 消費一致；`onNewNote: () => void` 在 Task 4 Sidebar props 與 App 傳入一致；後端回傳 `{ path, sha }` 與測試斷言一致。✅
