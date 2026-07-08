import { Hono } from 'hono';

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

const app = new Hono<{ Bindings: Env }>();
app.get('/api/health', (c) => c.json({ ok: true }));

export default app;
