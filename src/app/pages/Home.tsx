import { useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { buildFolderTree, type FolderNode } from '../folderTree';

export default function Home({ index }: { index: SiteIndex }) {
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const tree = useMemo(() => buildFolderTree(index.notes), [index]);
  const pill = (active: boolean) => ({
    fontSize: 12.5, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
    background: active ? 'var(--ab)' : 'transparent', color: active ? 'var(--ac)' : 'inherit', fontWeight: active ? 500 : 400,
  } as const);
  return (
    <div className="page-pad-home" style={{ maxWidth: 900 }}>
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
        {tree.map((node) => (
          <FolderSection key={node.fullPath} node={node} sort={sort} level={0} />
        ))}
      </div>
    </div>
  );
}

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
