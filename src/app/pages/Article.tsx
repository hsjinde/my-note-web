import { Fragment, useEffect, useMemo, useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { fetchNote, saveNote } from '../api';
import { renderMarkdown } from '../markdown';

const draftKey = (path: string) => `draft:${path}`;

export default function Article({ path, index, requireLogin, onSaved }: {
  path: string; index: SiteIndex; authed: boolean;
  requireLogin: (then: () => void) => void; onSaved: () => void;
}) {
  const [note, setNote] = useState<{ content: string; sha: string } | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    setNote(null); setError(false); setEditing(false); setSaveError('');
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

  const title = meta?.title ?? path.split('/').pop()!.replace(/\.md$/, '');
  useEffect(() => { document.title = `${title} · my-note`; }, [title]);

  const startEdit = () => requireLogin(() => {
    const saved = localStorage.getItem(draftKey(path));
    const hasSaved = saved != null && saved !== note!.content;
    setDraft(hasSaved ? saved : note!.content);
    setRestored(hasSaved);
    setEditing(true); setJustSaved(false); setConflict(false); setSaveError('');
  });

  const changeDraft = (v: string) => {
    setDraft(v);
    try { localStorage.setItem(draftKey(path), v); } catch { /* 容量滿時放棄本機備份，不阻擋編輯 */ }
  };

  const cancelEdit = () => {
    if (draft !== note!.content && !window.confirm('放棄未儲存的變更？')) return;
    localStorage.removeItem(draftKey(path));
    setEditing(false); setConflict(false); setSaveError('');
  };

  const doSave = async () => {
    if (saving) return;
    setSaving(true); setSaveError('');
    try {
      const r = await saveNote(path, draft, note!.sha);
      localStorage.removeItem(draftKey(path));
      setNote({ content: draft, sha: r.sha });
      setEditing(false); setJustSaved(true); setConflict(false);
      onSaved();
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      if ((e as Error).message === 'conflict') setConflict(true);
      else setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const loadRemote = async () => {
    setReloading(true);
    try {
      const fresh = await fetchNote(path);
      setNote(fresh); setConflict(false);
    } catch {
      setSaveError('無法載入最新版本，請稍後再試。');
    } finally {
      setReloading(false);
    }
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
      else if (e.key === 'Escape') cancelEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) {
    return (
      <div style={{ padding: 60 }}>
        <div style={{ color: 'var(--m2)', marginBottom: 16 }}>找不到這篇筆記，它可能已被移動或改名。</div>
        <a href="#/" style={{ color: 'var(--ac)', fontSize: 14 }}>回到首頁</a>
      </div>
    );
  }
  if (!note || !rendered) return <div style={{ padding: 60, color: 'var(--m2)' }}>載入中…</div>;

  if (editing) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--ln)', background: 'var(--pn)', flexWrap: 'wrap' }}>
          <span style={{ font: "11px 'IBM Plex Mono',monospace", letterSpacing: '.1em', color: 'var(--ac)', background: 'var(--ab)', borderRadius: 12, padding: '3px 10px', whiteSpace: 'nowrap' }}>編輯中</span>
          <span style={{ font: "600 16px 'Noto Serif TC',serif", color: 'var(--hd)' }}>{title}</span>
          <span style={{ font: "12px 'IBM Plex Mono',monospace", color: 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 60px' }}>{path}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn-reset" onClick={cancelEdit}
              style={{ fontSize: 13.5, border: '1px solid var(--ln)', borderRadius: 8, padding: '9px 16px', background: 'var(--bg)', color: 'var(--tx)' }}>取消</button>
            <button className="btn-reset" onClick={doSave} disabled={saving}
              style={{ fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '10px 18px', opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
        {restored && !conflict && !saveError && (
          <div role="status" style={{ padding: '10px 24px', background: 'var(--qb)', color: 'var(--m2)', fontSize: 13.5, borderBottom: '1px solid var(--ln)' }}>
            已還原上次未儲存的草稿。想從目前版本重新開始，先按「取消」再重新進入編輯。
          </div>
        )}
        {conflict && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 24px', background: 'var(--ab)', color: 'var(--ac)', fontSize: 13.5, borderBottom: '1px solid var(--ln)' }}>
            <span>這篇筆記在別處被更新過。你的草稿仍保留在下方，載入最新版本後再儲存即可。</span>
            <button className="btn-reset" onClick={loadRemote} disabled={reloading}
              style={{ fontSize: 13, fontWeight: 500, border: '1px solid var(--ac)', borderRadius: 8, padding: '5px 12px', color: 'var(--ac)', opacity: reloading ? 0.6 : 1 }}>
              {reloading ? '載入中…' : '載入最新版本'}
            </button>
          </div>
        )}
        {saveError && (
          <div role="alert" style={{ padding: '10px 24px', background: 'var(--ab)', color: 'var(--ac)', fontSize: 13.5, borderBottom: '1px solid var(--ln)' }}>
            儲存失敗（{saveError}）。你的草稿還在，稍後可以再按一次儲存。
          </div>
        )}
        <textarea className="editor-pad" value={draft} onChange={(e) => changeDraft(e.target.value)} spellCheck={false} aria-label="筆記內容"
          style={{ flex: 1, minHeight: 0, resize: 'none', border: 'none', outline: 'none', background: 'var(--bg)', color: 'var(--tx)', font: "14px/2 'IBM Plex Mono',monospace" }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 24px', borderTop: '1px solid var(--ln)', font: "11.5px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>
          <span>Markdown</span><span>{draft.length} 字元</span><span style={{ marginLeft: 'auto' }}>⌘S 儲存 · Esc 取消</span>
        </div>
      </div>
    );
  }

  const folderSegs = (meta?.folder ?? '').split('/').filter(Boolean);
  return (
    <div className="article-pad" style={{ position: 'relative', maxWidth: 1400 }}>
      {rendered.toc.length > 0 && (
        <nav aria-label="目錄" className="toc-panel" style={{ background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 10, padding: '16px 18px', boxShadow: '0 4px 14px rgba(58,50,38,.06)' }}>
          <div style={{ font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)', marginBottom: 10 }}>目錄</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            {rendered.toc.map((h) => (
              <a key={h.id} href={`#/note/${encodeURIComponent(path)}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' }); }}
                style={{ paddingLeft: h.level === 3 ? 14 : 0, color: h.level === 3 ? 'var(--m2)' : 'var(--tx)', cursor: 'pointer', textDecoration: 'none' }}>
                {h.text}
              </a>
            ))}
          </div>
        </nav>
      )}
      <nav aria-label="麵包屑" style={{ fontSize: 13, color: 'var(--mu)', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
        <a href="#/" style={{ color: 'var(--ac)', textDecoration: 'none', padding: '4px 0' }}>首頁</a>
        {folderSegs.map((seg, i) => (
          <Fragment key={i}><span>/</span><span>{seg}</span></Fragment>
        ))}
      </nav>
      <h1 style={{ font: "700 34px/1.3 'Noto Serif TC',serif", color: 'var(--hd)', margin: '0 0 14px' }}>{title}</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
        {meta?.date && <><span style={{ fontSize: 13, color: 'var(--m2)' }}>{meta.date}</span><span style={{ color: 'var(--ln)' }}>·</span></>}
        {meta?.tags.map((t) => (
          <button key={t} className="btn-reset" onClick={() => (location.hash = `#/tag/${encodeURIComponent(t)}`)}
            style={{ font: "12.5px 'IBM Plex Mono',monospace", color: 'var(--ac)', background: 'var(--ab)', borderRadius: 12, padding: '4px 10px' }}>#{t}</button>
        ))}
        <button className="btn-reset" onClick={startEdit}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--tx)', border: '1px solid var(--ln)', borderRadius: 8, padding: '8px 14px', background: 'var(--pn)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>編輯
        </button>
      </div>
      {justSaved && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--a2)', background: 'var(--ab)', borderRadius: 8, padding: '10px 14px', fontSize: 13.5, color: 'var(--ac)', marginBottom: 24 }}>✓ 已儲存變更並 commit 到 my-note</div>
      )}
      {rendered.toc.length > 0 && (
        <details className="toc-inline">
          <summary>目錄</summary>
          <nav aria-label="目錄">
            {rendered.toc.map((h) => (
              <a key={h.id} href={`#/note/${encodeURIComponent(path)}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' }); }}
                style={{ paddingLeft: h.level === 3 ? 14 : 0, color: h.level === 3 ? 'var(--m2)' : 'var(--tx)', textDecoration: 'none' }}>
                {h.text}
              </a>
            ))}
          </nav>
        </details>
      )}
      <div className="md-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      {backlinks.length > 0 && (
        <div style={{ borderTop: '1px solid var(--ln)', paddingTop: 24, marginTop: 40 }}>
          <div style={{ font: "500 12px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)', marginBottom: 14 }}>反向連結 · {backlinks.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 640 }}>
            {backlinks.map((b) => (
              <a key={b.path} className="btn-reset" href={`#/note/${encodeURIComponent(b.path)}`}
                style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 2px', borderBottom: '1px solid var(--ls)' }}>
                <span style={{ font: "600 15px 'Noto Serif TC',serif", color: 'var(--hd)', whiteSpace: 'nowrap' }}>{b.title}</span>
                <span style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--m2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.excerpt}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
