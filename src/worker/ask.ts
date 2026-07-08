import type { NoteMeta, SiteIndex } from '../shared/types';
import { shardKey } from './sync';

export function tokenize(q: string): string[] {
  const tokens: string[] = [];
  for (const m of q.toLowerCase().matchAll(/[a-z0-9_.-]+/g)) tokens.push(m[0]);
  for (const m of q.matchAll(/[一-鿿]+/g)) {
    const run = m[0];
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i + 1 < run.length; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

export function scoreNotes(index: SiteIndex, question: string, topN = 4): NoteMeta[] {
  const tokens = tokenize(question);
  const scored = index.notes.map((n) => {
    let score = 0;
    const title = n.title.toLowerCase();
    const excerpt = n.excerpt.toLowerCase();
    for (const t of tokens) {
      if (title.includes(t)) score += 5;
      if (n.tags.some((tag) => tag.toLowerCase().includes(t))) score += 3;
      if (excerpt.includes(t)) score += 1;
    }
    return { n, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (hits.length) return hits.slice(0, topN).map((s) => s.n);
  return [...index.notes]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 3);
}

export async function ask(
  env: { NOTES: KVNamespace; AI: Ai; AI_MODEL: string }, question: string,
): Promise<string> {
  const index = (await env.NOTES.get('meta:index', 'json')) as SiteIndex | null;
  if (!index || !index.notes.length) return '資料庫還沒有內容，請先執行同步。';
  const top = scoreNotes(index, question);
  const sections: string[] = [];
  for (const n of top) {
    const shard = (await env.NOTES.get(shardKey(n.path), 'json')) as Record<string, { content: string }> | null;
    const note = shard?.[n.path];
    if (note) sections.push(`【${n.title}】（${n.path}）\n${note.content.slice(0, 6000)}`);
  }
  const system =
    '你是個人筆記資料庫的問答助手。僅根據以下筆記內容回答，使用繁體中文，回答簡潔。' +
    '若筆記中沒有相關內容，請直接說明找不到，不要編造。\n\n' + sections.join('\n\n---\n\n');
  const result = (await env.AI.run(env.AI_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
  })) as { response?: string };
  return result.response ?? '（模型沒有回覆）';
}
