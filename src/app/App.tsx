import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './theme.css';
import { parseHash, type Route } from './router';
import { fetchIndex, me, login } from './api';
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
      else if (e.key === 'Escape') { setSearchOpen(false); setLoginOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { localStorage.setItem('dark', dark ? '1' : '0'); }, [dark]);

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
        onToggleDark={() => setDark(!dark)} onOpenSearch={() => setSearchOpen(true)} />
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
      <div ref={mainRef} style={{ overflowY: 'auto', minHeight: 0 }}>
        <div className="mobile-topbar">
          <div className="menu-toggle" onClick={() => setSidebarOpen(true)}>☰</div>
          <span style={{ font: "700 16px 'Noto Serif TC',serif", color: 'var(--hd)' }}>my-note</span>
        </div>
        {page}
      </div>
      {searchOpen && <SearchOverlay index={index} onClose={() => setSearchOpen(false)} />}
      {loginOpen && (
        <div onClick={() => setLoginOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(58,50,38,.28)', zIndex: 60, display: 'grid', placeItems: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(340px, 90vw)', background: 'var(--bg)', border: '1px solid var(--ln)', borderRadius: 14, padding: '26px 28px', boxShadow: '0 24px 60px rgba(26,20,12,.35)' }}>
            <div style={{ font: "600 18px 'Noto Serif TC',serif", color: 'var(--hd)', marginBottom: 14 }}>登入</div>
            <input type="password" value={password} autoFocus placeholder="站台密碼"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doLogin()}
              style={{ width: '100%', border: '1px solid var(--ln)', borderRadius: 8, padding: '10px 12px', background: 'var(--pn)', color: 'var(--hd)', font: "15px 'Noto Sans TC',sans-serif", outline: 'none' }} />
            {loginError && <div style={{ color: 'var(--ac)', fontSize: 13, marginTop: 8 }}>密碼錯誤</div>}
            <div onClick={doLogin} style={{ marginTop: 16, textAlign: 'center', fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '9px 0', cursor: 'pointer' }}>登入</div>
          </div>
        </div>
      )}
    </div>
  );
}
