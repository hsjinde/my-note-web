import { Hono } from 'hono';
import { isPublicPath, publicIndex } from './content';
import type { SiteIndex } from '../shared/types';

export interface Env {
  NOTES: KVNamespace;
  AI: Ai;
  SITE_PASSWORD: string;
  SESSION_SECRET: string;
  WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  AI_MODEL: string;
}

export function notePathFromUrl(url: string, prefix: string): string {
  const pathname = new URL(url).pathname;
  return decodeURIComponent(pathname.slice(prefix.length));
}

const app = new Hono<{ Bindings: Env }>();
app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/index', async (c) => {
  const idx = (await c.env.NOTES.get('meta:index', 'json')) as SiteIndex | null;
  if (!idx) return c.json({ notes: [], builtAt: null });
  return c.json(publicIndex(idx));
});

app.get('/api/note/*', async (c) => {
  const path = notePathFromUrl(c.req.url, '/api/note/');
  if (!isPublicPath(path)) return c.json({ error: 'not found' }, 404);
  const note = (await c.env.NOTES.get(`note:${path}`, 'json')) as { content: string; sha: string } | null;
  if (!note) return c.json({ error: 'not found' }, 404);
  return c.json({ path, content: note.content, sha: note.sha });
});

export default app;
