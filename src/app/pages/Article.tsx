import { useEffect, useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { fetchNote, saveNote } from '../api';
import { renderMarkdown } from '../markdown';

export default function Article({ path, index, requireLogin, onSaved }: {
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
