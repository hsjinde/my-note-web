import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { SiteIndex } from '../../shared/types';
import type { Route } from '../router';
import { buildFolderTree, type FolderNode } from '../folderTree';
import { QUICKNOTE_PATH, recentQuicknotes } from '../../shared/quicknote';
import { fetchNote, postQuicknote } from '../api';

export default function Sidebar({
  index, route, dark, currentPath, open: drawerOpen, requireLogin,
  onToggleDark, onOpenSearch, onQuicknoteSaved,
}: {
  index: SiteIndex; route: Route; dark: boolean; currentPath?: string; open: boolean;
  requireLogin: (then: () => void) => void;
  onToggleDark: () => void; onOpenSearch: () => void; onQuicknoteSaved: () => void;
}) {
  const tree = buildFolderTree(index.notes);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const current = currentPath ? index.notes.find((n) => n.path === currentPath) : undefined;
  const neighbors = current
    ? index.notes.filter((n) => current.linksTo.includes(n.path) || n.linksTo.includes(current.path)).slice(0, 5)
    : [];
  const label = { font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)' } as const;
  const positions = [[62, 30], [166, 38], [146, 82], [42, 70], [190, 78]];

  const [quicknoteText, setQuicknoteText] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [quicknoteError, setQuicknoteError] = useState(false);

  useEffect(() => {
    fetchNote(QUICKNOTE_PATH).then((n) => setRecent(recentQuicknotes(n.content))).catch(() => setRecent([]));
  }, []);

  const submitQuicknote = useCallback(() => {
    const text = quicknoteText.trim();
    if (!text || saving) return;
    requireLogin(async () => {
      setSaving(true);
      setQuicknoteError(false);
      try {
        const { recent } = await postQuicknote(text);
        setRecent(recent);
        setQuicknoteText('');
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
        onQuicknoteSaved();
      } catch {
        setQuicknoteError(true);
      } finally {
        setSaving(false);
      }
    });
  }, [quicknoteText, saving, requireLogin, onQuicknoteSaved]);

  return (
    <div className={`sidebar${drawerOpen ? ' open' : ''}`} style={{ borderRight: '1px solid var(--ln)', padding: '28px 22px 22px', display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
      <a className="btn-reset" href="#/" style={{ font: "700 22px 'Noto Serif TC',serif", color: 'var(--hd)' }}>my-note</a>
      <button className="btn-reset" onClick={onOpenSearch} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 8, padding: '8px 12px', color: 'var(--m2)', fontSize: 13.5, width: '100%' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        搜尋<span style={{ marginLeft: 'auto', font: "11px 'IBM Plex Mono',monospace", background: 'var(--ci)', border: '1px solid var(--ln)', borderRadius: 4, padding: '1px 5px' }}>⌘K</span>
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13.5, overflowY: 'auto' }}>
        <div style={{ ...label, marginBottom: 6 }}>總覽</div>
        {tree.map((node) => (
          <FolderBranch key={node.fullPath} node={node} open={open} setOpen={setOpen} currentPath={currentPath} />
        ))}
        <a className="btn-reset" href="#/tag/" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, marginTop: 8 }}>
          <span style={{ color: 'var(--mu)', fontSize: 10 }}>#</span>標籤
        </a>
        <a className="btn-reset" href="#/db"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, background: route.page === 'db' ? 'var(--ab)' : undefined, color: route.page === 'db' ? 'var(--ac)' : undefined, fontWeight: route.page === 'db' ? 500 : 400 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mu)" strokeWidth="2" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
          資料庫
        </a>
        <div style={{ marginTop: 8 }}>
          <div style={{ ...label, marginBottom: 6 }}>靈感</div>
          <textarea value={quicknoteText} onChange={(e) => setQuicknoteText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitQuicknote(); } }}
            placeholder="記下一個靈感…" aria-label="記下一個靈感" rows={2}
            style={{ width: '100%', resize: 'vertical', border: '1px solid var(--ln)', borderRadius: 8, padding: '8px 10px', background: 'var(--pn)', color: 'var(--hd)', font: "13px 'Noto Sans TC',sans-serif", outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 18 }}>
            <button className="btn-reset" onClick={submitQuicknote} disabled={saving}
              style={{ display: 'inline-block', font: "500 12.5px 'Noto Sans TC',sans-serif", color: '#fff', background: 'var(--ac)', borderRadius: 6, padding: '5px 12px', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? '記錄中…' : '記下來'}
            </button>
            {savedFlash && <span style={{ fontSize: 12, color: 'var(--mu)' }}>已記下</span>}
            {quicknoteError && <span role="alert" style={{ fontSize: 12, color: 'var(--ac)' }}>失敗，請再試一次</span>}
          </div>
          {recent.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
              {recent.map((entry, i) => (
                <a key={i} className="btn-reset" href={`#/note/${encodeURIComponent(QUICKNOTE_PATH)}`}
                  style={{ fontSize: 12, color: 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 4px' }}>
                  {entry.replace(/^- \[[^\]]+\]\s*/, '')}
                </a>
              ))}
            </div>
          )}
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
          <button className="btn-reset" onClick={onToggleDark} aria-label={dark ? '切換為亮色主題' : '切換為深色主題'} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--ln)', borderRadius: 20, padding: 4, background: 'var(--pn)' }}>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: dark ? 'transparent' : '#f6d36b88', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--hd)' }}>☀</span>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: dark ? 'rgba(236,149,102,.22)' : 'transparent', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--hd)' }}>☾</span>
          </button>
          <span style={{ font: "11px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>my-note</span>
        </div>
      </div>
    </div>
  );
}

function FolderBranch({ node, open, setOpen, currentPath }: {
  node: FolderNode; open: Record<string, boolean>;
  setOpen: Dispatch<SetStateAction<Record<string, boolean>>>; currentPath?: string;
}) {
  const isOpen = open[node.fullPath];
  return (
    <div>
      <button className="btn-reset" onClick={() => setOpen((o) => ({ ...o, [node.fullPath]: !o[node.fullPath] }))} aria-expanded={!!isOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, fontWeight: isOpen ? 500 : 400, width: '100%' }}>
        <span style={{ color: 'var(--mu)', fontSize: 10 }} aria-hidden="true">{isOpen ? '▾' : '▸'}</span>{node.name}
      </button>
      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 13, borderLeft: '1px solid var(--ln)', paddingLeft: 10 }}>
          {node.children.map((child) => (
            <FolderBranch key={child.fullPath} node={child} open={open} setOpen={setOpen} currentPath={currentPath} />
          ))}
          {node.notes.map((n) => {
            const active = currentPath === n.path;
            return (
              <a key={n.path} className="btn-reset" href={`#/note/${encodeURIComponent(n.path)}`} aria-current={active ? 'page' : undefined}
                style={{ padding: '5px 8px', borderRadius: 6, background: active ? 'var(--ab)' : undefined, color: active ? 'var(--ac)' : undefined, fontWeight: active ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.title}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
