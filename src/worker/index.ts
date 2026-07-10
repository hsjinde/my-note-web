import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { isPublicPath, publicIndex, parseNote } from './content';
import type { SiteIndex } from '../shared/types';
import { createSession, verifySession, SESSION_MAX_AGE } from './auth';
import { verifyGithubSignature } from './webhook';
import { fullSync, incrementalSync, rebuildIndexFromKV, shardKey, type PushPayload } from './sync';
import { GitHub, ShaConflictError } from './github';
import { ask } from './ask';
import { QUICKNOTE_PATH, appendQuicknote, formatTaipeiTimestamp, recentQuicknotes } from '../shared/quicknote';

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
  const shard = (await c.env.NOTES.get(shardKey(path), 'json')) as Record<string, { content: string; sha: string }> | null;
  const note = shard?.[path];
  if (!note) return c.json({ error: 'not found' }, 404);
  return c.json({ path, content: note.content, sha: note.sha });
});

const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!(await verifySession(getCookie(c, 'session'), c.env.SESSION_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

const github = (env: Env) => new GitHub(env.GITHUB_TOKEN, env.GITHUB_REPO, env.GITHUB_BRANCH);

app.post('/api/login', async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (password !== c.env.SITE_PASSWORD) return c.json({ error: 'wrong password' }, 401);
  setCookie(c, 'session', await createSession(c.env.SESSION_SECRET), {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MAX_AGE,
  });
  return c.json({ ok: true });
});

app.post('/api/logout', (c) => {
  setCookie(c, 'session', '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 0 });
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  return c.json({ authed: await verifySession(getCookie(c, 'session'), c.env.SESSION_SECRET) });
});

app.put('/api/note/*', requireAuth, async (c) => {
  const path = notePathFromUrl(c.req.url, '/api/note/');
  if (!isPublicPath(path)) return c.json({ error: 'not found' }, 404);
  const { content, sha } = await c.req.json<{ content: string; sha: string }>();
  const title = parseNote(path, content).title;
  try {
    const result = await github(c.env).putFile(path, content, `docs: 網頁編輯「${title}」`, sha);
    const key = shardKey(path);
    const shard = ((await c.env.NOTES.get(key, 'json')) as Record<string, { content: string; sha: string }> | null) ?? {};
    shard[path] = { content, sha: result.sha };
    await c.env.NOTES.put(key, JSON.stringify(shard));
    await rebuildIndexFromKV(c.env.NOTES);
    return c.json({ sha: result.sha });
  } catch (e) {
    if (e instanceof ShaConflictError) return c.json({ error: 'sha conflict' }, 409);
    throw e;
  }
});

app.post('/api/quicknote', requireAuth, async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const trimmed = text?.trim();
  if (!trimmed) return c.json({ error: 'empty text' }, 400);
  try {
    const gh = github(c.env);
    const existing = await gh.getFile(QUICKNOTE_PATH);
    const content = appendQuicknote(existing?.content ?? null, trimmed, formatTaipeiTimestamp(new Date()));
    const result = await gh.putFile(QUICKNOTE_PATH, content, 'docs: 靈感', existing?.sha);
    const key = shardKey(QUICKNOTE_PATH);
    const shard = ((await c.env.NOTES.get(key, 'json')) as Record<string, { content: string; sha: string }> | null) ?? {};
    shard[QUICKNOTE_PATH] = { content, sha: result.sha };
    await c.env.NOTES.put(key, JSON.stringify(shard));
    await rebuildIndexFromKV(c.env.NOTES);
    return c.json({ recent: recentQuicknotes(content) });
  } catch (e) {
    if (e instanceof ShaConflictError) return c.json({ error: 'sha conflict' }, 409);
    throw e;
  }
});

app.post('/api/note', requireAuth, async (c) => {
  const { folder, title } = await c.req.json<{ folder: string; title: string }>();
  const t = title?.trim();
  if (!t) return c.json({ error: 'empty title' }, 400);
  if (/[/\\:*?"<>|]/.test(t)) return c.json({ error: 'invalid title' }, 400);
  const path = `${folder}/${t}.md`;
  if (!isPublicPath(path)) return c.json({ error: 'invalid path' }, 400);

  const key = shardKey(path);
  const shard = ((await c.env.NOTES.get(key, 'json')) as Record<string, { content: string; sha: string }> | null) ?? {};
  if (shard[path]) return c.json({ error: 'already exists' }, 409);

  const gh = github(c.env);
  if (await gh.getFile(path)) return c.json({ error: 'already exists' }, 409);

  const content = `---\ntitle: ${t}\n---\n\n`;
  try {
    const result = await gh.putFile(path, content, `docs: 新增「${t}」`);
    shard[path] = { content, sha: result.sha };
    await c.env.NOTES.put(key, JSON.stringify(shard));
    await rebuildIndexFromKV(c.env.NOTES);
    return c.json({ path, sha: result.sha });
  } catch (e) {
    if (e instanceof ShaConflictError) return c.json({ error: 'already exists' }, 409);
    throw e;
  }
});

app.post('/api/sync', requireAuth, async (c) => {
  return c.json(await fullSync(c.env.NOTES, github(c.env)));
});

app.post('/api/webhook', async (c) => {
  const raw = await c.req.text();
  const ok = await verifyGithubSignature(c.env.WEBHOOK_SECRET, raw, c.req.header('X-Hub-Signature-256'));
  if (!ok) return c.json({ error: 'bad signature' }, 401);
  const payload = JSON.parse(raw) as PushPayload;
  return c.json(await incrementalSync(c.env.NOTES, github(c.env), payload));
});

app.post('/api/ask', requireAuth, async (c) => {
  const { question } = await c.req.json<{ question: string }>();
  if (!question?.trim()) return c.json({ error: 'empty question' }, 400);
  return c.json({ answer: await ask(c.env, question.trim()) });
});

export default app;
