# 資料夾巢狀分類 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓網站的 Sidebar、首頁、麵包屑反映筆記在原始 Obsidian vault 中的完整資料夾路徑（支援任意深度的子資料夾，如「個人學習/LeetCode」「個人學習/多益」），不再把子資料夾打平混在同一層。

**Architecture:** 把 `NoteMeta.folder` 的語意從「路徑第一層」改成「完整資料夾路徑（不含檔名）」，新增一個共用的 `buildFolderTree` 工具把扁平的 `NoteMeta[]` 轉成巢狀樹，Sidebar 與首頁都改用這棵樹做遞迴渲染。

**Tech Stack:** TypeScript、React 19、Vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-nested-folder-classification-design.md`

## Global Constraints

- `folder` 欄位語意：完整資料夾路徑，不含檔名（例：`個人學習/LeetCode/a.md` → `folder = '個人學習/LeetCode'`）。
- 不新增「依資料夾篩選」的頁面或路由。
- 麵包屑不做可點擊連結，純文字。
- `PUBLIC_FOLDERS` / `AI_EXTRA_FOLDERS` 白名單判斷邏輯（`src/worker/content.ts` 的 `inFolders`）不變，因為它本來就用完整路徑 `startsWith` 判斷，不依賴 `folder` 欄位。
- 資料夾排序一律用 `localeCompare(b, 'zh-Hant')`。已驗證的排序結果（供測試斷言使用）：
  - `['好工具推薦','個人學習','工作專案']` → `['工作專案','好工具推薦','個人學習']`
  - `['LeetCode','Obsidian筆記','多益']` → `['多益','LeetCode','Obsidian筆記']`

---

## 共用型別（Task 2 建立，供 Task 3、4 引用）

`src/app/folderTree.ts`：

```ts
export interface FolderNode {
  name: string;       // 該層資料夾名稱
  fullPath: string;   // 該層完整路徑（展開狀態 / React key 用）
  notes: NoteMeta[];  // 直接位於此資料夾（非子資料夾）的筆記
  children: FolderNode[]; // 子資料夾節點，依 zh-Hant 排序
}

export function buildFolderTree(notes: NoteMeta[]): FolderNode[];
```

---

### Task 1: `NoteMeta.folder` 改為完整資料夾路徑

**Files:**
- Modify: `src/worker/content.ts:42`
- Modify: `src/shared/types.ts:4`
- Test: `tests/content.test.ts`

**Interfaces:**
- Produces: `parseNote(path, md).folder` 回傳完整資料夾路徑（不含檔名），供 Task 2 的 `buildFolderTree` 消費。

- [ ] **Step 1: 寫失敗測試**

在 `tests/content.test.ts` 的 `describe('parseNote', ...)` 區塊內，緊接在既有的 `it('無 frontmatter 用檔名當標題、date null', ...)` 之後加入：

```ts
  it('folder 為完整資料夾路徑（含子資料夾）', () => {
    const nested = parseNote('個人學習/LeetCode/兩數之和.md', '# 內文');
    expect(nested.folder).toBe('個人學習/LeetCode');
  });
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`npx vitest run tests/content.test.ts`
預期：新增的測試 FAIL，因為目前 `folder` 回傳 `'個人學習'`（只取第一層）而非 `'個人學習/LeetCode'`。既有測試（含 `expect(meta.folder).toBe('好工具推薦')`）仍應 PASS。

- [ ] **Step 3: 修改 `parseNote` 的 folder 計算**

`src/worker/content.ts:42`，把：

```ts
    folder: path.split('/')[0],
```

改成：

```ts
    folder: path.split('/').slice(0, -1).join('/'),
```

- [ ] **Step 4: 同步更新型別註解**

`src/shared/types.ts:4`，把：

```ts
  folder: string; // 第一層資料夾名
```

改成：

```ts
  folder: string; // 完整資料夾路徑（不含檔名），如 '個人學習/LeetCode'
```

- [ ] **Step 5: 執行測試確認通過**

執行：`npx vitest run tests/content.test.ts`
預期：全部 PASS，包含新測試與既有的 `好工具推薦` 頂層案例。

- [ ] **Step 6: 執行全部測試確保沒有連帶破壞**

執行：`npx vitest run`
預期：全部 PASS（`tests/index-build.test.ts` 等其他檔案不依賴 `folder` 欄位的舊語意，理應不受影響）。

- [ ] **Step 7: Commit**

```bash
git add src/worker/content.ts src/shared/types.ts tests/content.test.ts
git commit -m "feat: NoteMeta.folder 改為完整資料夾路徑以支援巢狀分類"
```

---

### Task 2: 共用資料夾樹工具 `buildFolderTree`

**Files:**
- Create: `src/app/folderTree.ts`
- Test: `tests/folderTree.test.ts`

**Interfaces:**
- Consumes: `NoteMeta`（`src/shared/types.ts`，`folder` 為完整路徑，Task 1 已完成）。
- Produces: `FolderNode` 介面與 `buildFolderTree(notes: NoteMeta[]): FolderNode[]`，供 Task 3（Sidebar）、Task 4（Home）使用。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/folderTree.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildFolderTree } from '../src/app/folderTree';
import type { NoteMeta } from '../src/shared/types';

function note(path: string, folder: string): NoteMeta {
  return { path, title: path, folder, tags: [], date: null, excerpt: '', links: [], linksTo: [], private: false };
}

describe('buildFolderTree', () => {
  const notes = [
    note('個人學習/LeetCode/a.md', '個人學習/LeetCode'),
    note('個人學習/多益/b.md', '個人學習/多益'),
    note('個人學習/c.md', '個人學習'),
    note('好工具推薦/d.md', '好工具推薦'),
    note('工作專案/e.md', '工作專案'),
  ];
  const tree = buildFolderTree(notes);

  it('頂層依 zh-Hant 排序', () => {
    expect(tree.map((n) => n.name)).toEqual(['工作專案', '好工具推薦', '個人學習']);
  });

  it('子資料夾巢狀掛在正確的父節點下，且依 zh-Hant 排序', () => {
    const study = tree.find((n) => n.name === '個人學習')!;
    expect(study.fullPath).toBe('個人學習');
    expect(study.children.map((n) => n.name)).toEqual(['多益', 'LeetCode']);
    expect(study.children[0].fullPath).toBe('個人學習/多益');
    expect(study.children[1].fullPath).toBe('個人學習/LeetCode');
  });

  it('筆記掛在直屬資料夾節點的 notes，不會外溢到其他層', () => {
    const study = tree.find((n) => n.name === '個人學習')!;
    expect(study.notes.map((n) => n.path)).toEqual(['個人學習/c.md']);
    const leetcode = study.children.find((n) => n.name === 'LeetCode')!;
    expect(leetcode.notes.map((n) => n.path)).toEqual(['個人學習/LeetCode/a.md']);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`npx vitest run tests/folderTree.test.ts`
預期：FAIL，錯誤訊息類似 `Cannot find module '../src/app/folderTree'`（檔案還不存在）。

- [ ] **Step 3: 實作 `buildFolderTree`**

建立 `src/app/folderTree.ts`：

```ts
import type { NoteMeta } from '../shared/types';

export interface FolderNode {
  name: string;
  fullPath: string;
  notes: NoteMeta[];
  children: FolderNode[];
}

export function buildFolderTree(notes: NoteMeta[]): FolderNode[] {
  const root: FolderNode[] = [];
  const nodeByPath = new Map<string, FolderNode>();

  const getOrCreate = (segments: string[]): FolderNode => {
    const fullPath = segments.join('/');
    const existing = nodeByPath.get(fullPath);
    if (existing) return existing;
    const node: FolderNode = { name: segments[segments.length - 1], fullPath, notes: [], children: [] };
    nodeByPath.set(fullPath, node);
    if (segments.length === 1) {
      root.push(node);
    } else {
      getOrCreate(segments.slice(0, -1)).children.push(node);
    }
    return node;
  };

  for (const n of notes) {
    getOrCreate(n.folder.split('/')).notes.push(n);
  }

  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    for (const node of nodes) sortRec(node.children);
  };
  sortRec(root);

  return root;
}
```

- [ ] **Step 4: 執行測試確認通過**

執行：`npx vitest run tests/folderTree.test.ts`
預期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/folderTree.ts tests/folderTree.test.ts
git commit -m "feat: 新增共用資料夾樹工具 buildFolderTree"
```

---

### Task 3: Sidebar 改為巢狀可展開樹

**Files:**
- Modify: `src/app/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `buildFolderTree`、`FolderNode`（`src/app/folderTree.ts`，Task 2 已完成）。

- [ ] **Step 1: 移除舊的第一層分組邏輯，改用 `buildFolderTree`**

`src/app/components/Sidebar.tsx` 開頭的 import 區塊，把：

```tsx
import { useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import type { Route } from '../router';
```

改成：

```tsx
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { SiteIndex } from '../../shared/types';
import type { Route } from '../router';
import { buildFolderTree, type FolderNode } from '../folderTree';
```

把函式開頭（第 9–14 行）的：

```tsx
  const folders: [string, SiteIndex['notes']][] = [];
  const folderMap = new Map<string, SiteIndex['notes']>();
  for (const n of index.notes) {
    if (!folderMap.has(n.folder)) { folderMap.set(n.folder, []); folders.push([n.folder, folderMap.get(n.folder)!]); }
    folderMap.get(n.folder)!.push(n);
  }
```

改成：

```tsx
  const tree = buildFolderTree(index.notes);
```

- [ ] **Step 2: 把渲染區塊改成呼叫遞迴子元件**

把原本第 32–52 行的：

```tsx
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
```

改成：

```tsx
        {tree.map((node) => (
          <FolderBranch key={node.fullPath} node={node} open={open} setOpen={setOpen} currentPath={currentPath} />
        ))}
```

- [ ] **Step 3: 在檔案底部（`export default function Sidebar` 結束之後）新增遞迴子元件**

```tsx
function FolderBranch({ node, open, setOpen, currentPath }: {
  node: FolderNode; open: Record<string, boolean>;
  setOpen: Dispatch<SetStateAction<Record<string, boolean>>>; currentPath?: string;
}) {
  const isOpen = open[node.fullPath];
  return (
    <div>
      <div onClick={() => setOpen((o) => ({ ...o, [node.fullPath]: !o[node.fullPath] }))}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontWeight: isOpen ? 500 : 400 }}>
        <span style={{ color: 'var(--mu)', fontSize: 10 }}>{isOpen ? '▾' : '▸'}</span>{node.name}
      </div>
      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 13, borderLeft: '1px solid var(--ln)', paddingLeft: 10 }}>
          {node.children.map((child) => (
            <FolderBranch key={child.fullPath} node={child} open={open} setOpen={setOpen} currentPath={currentPath} />
          ))}
          {node.notes.map((n) => {
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
  );
}
```

- [ ] **Step 4: 型別檢查**

執行：`npx tsc --noEmit`
預期：無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Sidebar.tsx
git commit -m "feat: Sidebar 改為巢狀可展開資料夾樹"
```

---

### Task 4: 首頁改為巢狀分區

**Files:**
- Modify: `src/app/pages/Home.tsx`

**Interfaces:**
- Consumes: `buildFolderTree`、`FolderNode`（`src/app/folderTree.ts`，Task 2 已完成）。

- [ ] **Step 1: 改 import，移除舊的分組 `useMemo`**

把檔案開頭：

```tsx
import { useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';
```

改成：

```tsx
import { useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { buildFolderTree, type FolderNode } from '../folderTree';
```

把函式體開頭原本第 6–18 行的：

```tsx
  const sections = useMemo(() => {
    const map = new Map<string, SiteIndex['notes']>();
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
```

改成：

```tsx
  const tree = useMemo(() => buildFolderTree(index.notes), [index]);
```

- [ ] **Step 2: 改渲染區塊**

把原本第 36–52 行的：

```tsx
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
```

改成：

```tsx
      <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
        {tree.map((node) => (
          <FolderSection key={node.fullPath} node={node} sort={sort} level={0} />
        ))}
      </div>
```

- [ ] **Step 3: 在檔案底部（`export default function Home` 結束之後）新增遞迴輔助函式與子元件**

```tsx
function countNotes(node: FolderNode): number {
  return node.notes.length + node.children.reduce((sum, c) => sum + countNotes(c), 0);
}

function sortNotes(notes: SiteIndex['notes'], sort: 'recent' | 'name') {
  return [...notes].sort((a, b) => sort === 'recent'
    ? (b.date ?? '').localeCompare(a.date ?? '')
    : a.title.localeCompare(b.title, 'zh-Hant'));
}

function FolderSection({ node, sort, level }: { node: FolderNode; sort: 'recent' | 'name'; level: number }) {
  const titleFont = level === 0 ? "600 20px 'Noto Serif TC',serif" : "600 15px 'Noto Serif TC',serif";
  return (
    <div style={{ marginLeft: level === 0 ? 0 : 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '1px solid var(--ln)', paddingBottom: 8, marginBottom: 6, marginTop: level === 0 ? 0 : 18 }}>
        <span style={{ font: titleFont, color: 'var(--hd)' }}>{node.name}</span>
        <span style={{ font: "12px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{countNotes(node)}</span>
      </div>
      {sortNotes(node.notes, sort).map((n) => (
        <div key={n.path} onClick={() => (location.hash = `#/note/${encodeURIComponent(n.path)}`)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 2px', borderBottom: '1px solid var(--ls)', cursor: 'pointer' }}>
          <span style={{ fontSize: 15.5 }}>{n.title}</span>
          <span style={{ font: "12.5px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{n.date ?? ''}</span>
        </div>
      ))}
      {node.children.map((child) => (
        <FolderSection key={child.fullPath} node={child} sort={sort} level={level + 1} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 型別檢查**

執行：`npx tsc --noEmit`
預期：無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/Home.tsx
git commit -m "feat: 首頁改為巢狀資料夾分區"
```

---

### Task 5: 文章頁麵包屑顯示完整路徑

**Files:**
- Modify: `src/app/pages/Article.tsx`

- [ ] **Step 1: import `Fragment`**

把第 1 行：

```tsx
import { useEffect, useMemo, useState } from 'react';
```

改成：

```tsx
import { Fragment, useEffect, useMemo, useState } from 'react';
```

- [ ] **Step 2: 把麵包屑的 `{meta?.folder}` 拆成多段**

把第 106 行：

```tsx
        <span onClick={() => (location.hash = '#/')} style={{ cursor: 'pointer' }}>首頁</span><span>/</span><span>{meta?.folder}</span>
```

改成：

```tsx
        <span onClick={() => (location.hash = '#/')} style={{ cursor: 'pointer' }}>首頁</span>
        {(meta?.folder ?? '').split('/').map((seg, i) => (
          <Fragment key={i}><span>/</span><span>{seg}</span></Fragment>
        ))}
```

- [ ] **Step 3: 型別檢查**

執行：`npx tsc --noEmit`
預期：無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/Article.tsx
git commit -m "feat: 文章頁麵包屑顯示完整資料夾路徑"
```

---

### Task 6: 建置與瀏覽器驗證

**Files:** 無新增/修改（純驗證）

- [ ] **Step 1: 完整測試**

執行：`npx vitest run`
預期：全部 PASS（含 Task 1、2 新增的測試）。

- [ ] **Step 2: 建置**

執行：`npm run build`
預期：成功，無 TypeScript 錯誤，`dist/` 產出。

- [ ] **Step 3: 瀏覽器手動驗證（用 preview 工具）**

在跑起來的 dev server 上依序確認：
1. 重新整理頁面，Sidebar 中「個人學習」展開後應該看到子資料夾（如 LeetCode、多益）而不是所有筆記混在同一層；點子資料夾可再展開看到裡面的筆記。
2. 首頁「個人學習」區塊底下應該出現子資料夾的次級標題與各自的筆數，而不是所有筆記平鋪在一起。
3. 點進一篇位於子資料夾的筆記（如 `個人學習/LeetCode/xxx.md`），麵包屑應顯示「首頁 / 個人學習 / LeetCode」，且不可點擊（只有「首頁」可點）。
4. 開啟搜尋（⌘K），確認搜尋結果卡片下方顯示的資料夾路徑是完整路徑（如「個人學習/LeetCode」）。

不需要 commit（此任務無程式碼變更）。
