import { useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { askDb } from '../api';

interface Msg { id: number; q: string; a: string; pending: boolean }
const SAMPLES = ['notebooklm 要怎麼重新登入？', '目前啟用了哪些 MCP server？', '改了 opencode.json 之後要做什麼？'];

export default function AskDb({ index, authed, requireLogin }: {
  index: SiteIndex; authed: boolean; requireLogin: (then: () => void) => void;
}) {
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<Msg[]>([]);
  const [asking, setAsking] = useState(false);

  const send = (text?: string) => {
    const q = (text ?? question).trim();
    if (!q || asking) return;
    requireLogin(async () => {
      const id = Date.now();
      setQuestion(''); setAsking(true);
      setChat((c) => [...c, { id, q, a: '', pending: true }]);
      let a: string;
      try { a = await askDb(q); } catch { a = '查詢失敗，請再試一次。'; }
      setChat((c) => c.map((m) => (m.id === id ? { ...m, a, pending: false } : m)));
      setAsking(false);
    });
  };

  return (
    <div className="page-pad-md" style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 14 }}>
        <span onClick={() => (location.hash = '#/')} style={{ cursor: 'pointer' }}>首頁</span> / 資料庫
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={{ font: "700 32px 'Noto Serif TC',serif", color: 'var(--hd)' }}>問資料庫</span>
        <span style={{ font: "13px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{index.notes.length} 篇筆記</span>
      </div>
      <p style={{ margin: '0 0 24px', fontSize: 14.5, lineHeight: 1.9, color: 'var(--mu)' }}>
        輸入問題，Agent 會根據筆記資料庫的內容回覆。{!authed && '（需要登入）'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 10, padding: '6px 6px 6px 16px', marginBottom: 28 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z" /></svg>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="例如：notebooklm 要怎麼重新登入？"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', font: "15px 'Noto Sans TC',sans-serif", color: 'var(--hd)' }} />
        <span onClick={() => send()} style={{ fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', whiteSpace: 'nowrap' }}>送出</span>
      </div>
      {chat.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)' }}>試試這些問題</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SAMPLES.map((s) => (
              <span key={s} onClick={() => send(s)}
                style={{ fontSize: 13.5, border: '1px solid var(--ln)', background: 'var(--pn)', borderRadius: 18, padding: '7px 16px', cursor: 'pointer' }}>{s}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {chat.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '75%', background: 'var(--ab)', color: 'var(--hd)', borderRadius: '12px 12px 2px 12px', padding: '10px 16px', fontSize: 14.5, lineHeight: 1.8 }}>{m.q}</div>
            <div style={{ background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: '2px 12px 12px 12px', padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: '.1em', color: 'var(--ac)' }}>AGENT</span>
                <span style={{ font: "11px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{m.pending ? '檢索資料庫中…' : '已根據資料庫回覆'}</span>
              </div>
              {m.pending
                ? <div style={{ fontSize: 14, color: 'var(--mu)' }}>思考中…</div>
                : <div style={{ fontSize: 14.5, lineHeight: 2, whiteSpace: 'pre-wrap' }}>{m.a}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
