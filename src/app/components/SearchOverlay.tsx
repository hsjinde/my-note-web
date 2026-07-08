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
