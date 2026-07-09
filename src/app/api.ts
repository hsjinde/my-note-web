import type { SiteIndex } from '../shared/types';

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new Error('unauthorized');
  if (res.status === 409) throw new Error('conflict');
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchIndex = () => fetch('/api/index').then((r) => json<SiteIndex>(r));
export const fetchNote = (path: string) =>
  fetch(`/api/note/${encodeURIComponent(path)}`).then((r) => json<{ path: string; content: string; sha: string }>(r));
export const saveNote = (path: string, content: string, sha: string) =>
  fetch(`/api/note/${encodeURIComponent(path)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, sha }),
  }).then((r) => json<{ sha: string }>(r));
export const login = (password: string) =>
  fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then((r) => r.ok);
export const me = () => fetch('/api/me').then((r) => json<{ authed: boolean }>(r)).then((d) => d.authed);
export const askDb = (question: string) =>
  fetch('/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  }).then((r) => json<{ answer: string }>(r)).then((d) => d.answer);
export const triggerSync = () =>
  fetch('/api/sync', { method: 'POST' }).then((r) => json<{ synced: number }>(r)).then(() => undefined);
export const postQuicknote = (text: string) =>
  fetch('/api/quicknote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then((r) => json<{ recent: string[] }>(r));
