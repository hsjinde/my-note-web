import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './theme.css';
import { parseHash, type Route } from './router';
import { fetchIndex, me, login, postNote } from './api';
import { PUBLIC_FOLDERS } from '../shared/folders';
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newFolder, setNewFolder] = useState(PUBLIC_FOLDERS[0]);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const pendingRef = useRef<(() => void) | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const reloadIndex = useCallback(() => { fetchIndex().then(setIndex).catch(() => {}); }, []);
  useEffect(() => { reloadIndex(); me().then(setAuthed).catch(() => {}); }, [reloadIndex]);
  useEffect(() => {
    const onHash = () => { setRoute(parseHash(location.hash)); mainRef.current?.scrollTo(0, 0); setSidebarOpen(false); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      else if (e.key === 'Escape') { setSearchOpen(false); setLoginOpen(false); setNewNoteOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { localStorage.setItem('dark', dark ? '1' : '0'); }, [dark]);
  useEffect(() => { if (route.page !== 'article') document.title = 'my-note'; }, [route]);

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
    <div className="app-shell" data-dark={dark ? 'true' : 'false'} style={{ height: '100vh', display: 'grid', gridTemplateColumns: '280px 1fr', background: 'var(--bg)', color: 'var(--tx)', transition: 'background .25s', position: 'relative', overflow: 'hidden' }}>
      <Sidebar index={index} route={route} dark={dark} currentPath={currentPath} open={sidebarOpen}
        requireLogin={requireLogin} onNewNote={() => requireLogin(openNewNote)}
        onToggleDark={() => setDark(!dark)} onOpenSearch={() => setSearchOpen(true)} onQuicknoteSaved={reloadIndex} />
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
      <div ref={mainRef} style={{ overflowY: 'auto', minHeight: 0 }}>
        <div className="mobile-topbar">
          <button className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="開啟選單">☰</button>
          <span style={{ font: "700 16px 'Noto Serif TC',serif", color: 'var(--hd)' }}>my-note</span>
        </div>
        {page}
      </div>
      {searchOpen && <SearchOverlay index={index} onClose={() => setSearchOpen(false)} />}
      {loginOpen && (
        <div onClick={() => setLoginOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(58,50,38,.28)', zIndex: 60, display: 'grid', placeItems: 'center' }}>
          <div role="dialog" aria-modal="true" aria-label="登入" onClick={(e) => e.stopPropagation()} style={{ width: 'min(340px, 90vw)', background: 'var(--bg)', border: '1px solid var(--ln)', borderRadius: 14, padding: '26px 28px', boxShadow: '0 24px 60px rgba(26,20,12,.35)' }}>
            <div style={{ font: "600 18px 'Noto Serif TC',serif", color: 'var(--hd)', marginBottom: 6 }}>登入</div>
            <div style={{ fontSize: 13, color: 'var(--m2)', marginBottom: 14 }}>編輯與問資料庫是站主專用功能，需要站台密碼。</div>
            <input type="password" value={password} autoFocus placeholder="站台密碼" aria-label="站台密碼"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doLogin()}
              style={{ width: '100%', border: '1px solid var(--ln)', borderRadius: 8, padding: '10px 12px', background: 'var(--pn)', color: 'var(--hd)', font: "15px 'Noto Sans TC',sans-serif" }} />
            {loginError && <div role="alert" style={{ color: 'var(--ac)', fontSize: 13, marginTop: 8 }}>密碼錯誤，請再試一次。</div>}
            <button className="btn-reset" onClick={doLogin} style={{ marginTop: 16, width: '100%', textAlign: 'center', fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '10px 0' }}>登入</button>
          </div>
        </div>
      )}
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
    </div>
  );
}
