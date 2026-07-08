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
    <div className="page-pad-md" style={{ maxWidth: 760 }}>
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
