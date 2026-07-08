import { useState } from 'react';
import type { SiteIndex } from '../../shared/types';
import { askDb } from '../api';

interface Msg { id: number; q: string; a: string; pending: boolean; failed?: boolean }
const SAMPLES = ['notebooklm 要怎麼重新登入？', '目前啟用了哪些 MCP server？', '改了 opencode.json 之後要做什麼？'];

export default function AskDb({ index, authed, requireLogin }: {
  index: SiteIndex; authed: boolean; requireLogin: (then: () => void) => void;
}) {
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<Msg[]>([]);
  const [asking, setAsking] = useState(false);

  const ask = async (id: number, q: string) => {
    setAsking(true);
    let a: string; let failed = false;
    try { a = await askDb(q); } catch { a = '查詢失敗，可能是網路或伺服器暫時出了狀況。'; failed = true; }
    setChat((c) => c.map((m) => (m.id === id ? { ...m, a, pending: false, failed } : m)));
    setAsking(false);
  };

  const send = (text?: string) => {
    const q = (text ?? question).trim();
    if (!q || asking) return;
    requireLogin(() => {
      const id = Date.now();
      setQuestion('');
      setChat((c) => [...c, { id, q, a: '', pending: true }]);
      void ask(id, q);
    });
  };

  const retry = (m: Msg) => {
    if (asking) return;
    setChat((c) => c.map((x) => (x.id === m.id ? { ...x, a: '', pending: true, failed: false } : x)));
    void ask(m.id, m.q);
  };

  return (
    <div className="page-pad-md" style={{ maxWidth: 900 }}>
      <nav aria-label="麵包屑" style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 14 }}>
        <a href="#/" style={{ color: 'var(--ac)', textDecoration: 'none', padding: '4px 0' }}>首頁</a> / 資料庫
      </nav>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={{ font: "700 32px 'Noto Serif TC',serif", color: 'var(--hd)' }}>問資料庫</span>
        <span style={{ font: "13px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{index.notes.length} 篇筆記</span>
      </div>
      <p style={{ margin: '0 0 24px', fontSize: 14.5, lineHeight: 1.9, color: 'var(--m2)' }}>
        輸入問題，Agent 會根據筆記資料庫的內容回覆。{!authed && '（需要登入）'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: 10, padding: '6px 6px 6px 16px', marginBottom: 28 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z" /></svg>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="例如：notebooklm 要怎麼重新登入？" aria-label="輸入問題"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', font: "15px 'Noto Sans TC',sans-serif", color: 'var(--hd)' }} />
        <button className="btn-reset" onClick={() => send()} disabled={asking || !question.trim()}
          style={{ fontSize: 13.5, fontWeight: 500, color: '#fff', background: 'var(--ac)', borderRadius: 8, padding: '10px 20px', whiteSpace: 'nowrap', opacity: asking || !question.trim() ? 0.55 : 1, cursor: asking ? 'wait' : 'pointer' }}>
          {asking ? '詢問中…' : '送出'}
        </button>
      </div>
      {chat.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: "500 11px 'Noto Sans TC',sans-serif", letterSpacing: '.12em', color: 'var(--mu)' }}>試試這些問題</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SAMPLES.map((s) => (
              <button key={s} className="btn-reset" onClick={() => send(s)} disabled={asking}
                style={{ fontSize: 13.5, border: '1px solid var(--ln)', background: 'var(--pn)', borderRadius: 999, padding: '9px 16px', color: 'var(--tx)' }}>{s}</button>
            ))}
          </div>
        </div>
      )}
      <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {chat.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '75%', background: 'var(--ab)', color: 'var(--hd)', borderRadius: '10px 10px 2px 10px', padding: '10px 16px', fontSize: 14.5, lineHeight: 1.8, overflowWrap: 'break-word' }}>{m.q}</div>
            <div style={{ background: 'var(--pn)', border: '1px solid var(--ln)', borderRadius: '2px 10px 10px 10px', padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: '.1em', color: 'var(--ac)' }}>AGENT</span>
                <span style={{ font: "11px 'IBM Plex Mono',monospace", color: 'var(--mu)' }}>{m.pending ? '檢索資料庫中…' : m.failed ? '查詢失敗' : '已根據資料庫回覆'}</span>
              </div>
              {m.pending
                ? <div style={{ fontSize: 14, color: 'var(--m2)' }}>思考中…</div>
                : (
                  <>
                    <div style={{ fontSize: 14.5, lineHeight: 2, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: m.failed ? 'var(--m2)' : undefined }}>{m.a}</div>
                    {m.failed && (
                      <button className="btn-reset" onClick={() => retry(m)} disabled={asking}
                        style={{ marginTop: 10, fontSize: 13, fontWeight: 500, border: '1px solid var(--ac)', borderRadius: 8, padding: '6px 14px', color: 'var(--ac)', opacity: asking ? 0.6 : 1 }}>再試一次</button>
                    )}
                  </>
                )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
