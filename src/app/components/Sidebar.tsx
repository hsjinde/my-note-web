import { useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import type { Route } from '../router';

export default function Sidebar({ index, route, dark, currentPath, open: drawerOpen, onToggleDark, onOpenSearch }: {
  index: SiteIndex; route: Route; dark: boolean; currentPath?: string; open: boolean;
  onToggleDark: () => void; onOpenSearch: () => void;
}) {
  const folders: [string, SiteIndex['notes']][] = [];
  const folderMap = new Map<string, SiteIndex['notes']>();
  for (const n of index.notes) {
    if (!folderMap.has(n.folder)) { folderMap.set(n.folder, []); folders.push([n.folder, folderMap.get(n.folder)!]); }
    folderMap.get(n.folder)!.push(n);
  }
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const current = currentPath ? index.notes.find((n) => n.path === currentPath) : undefined;
  const neighbors = current
    ? index.notes.filter((n) => current.linksTo.includes(n.path) || n.linksTo.includes(current.path)).slice(0, 5)
    : [];
  const label = { font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)' } as const;
  const positions = [[62, 30], [166, 38], [146, 82], [42, 70], [190, 78]];

  return (
    <div className={`sidebar${drawerOpen ? ' open' : ''}`} style={{ borderRight: '1px solid var(--ln)', padding: '28px 22px 22px', display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
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
