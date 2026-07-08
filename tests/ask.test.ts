import { describe, it, expect, vi } from 'vitest';
import { tokenize, scoreNotes, ask } from '../src/worker/ask';
import { buildIndex } from '../src/worker/content';
import { mockKV } from './helpers';

const idx = buildIndex([
  { path: '好工具推薦/opencode-mcp.md', content: '---\ntitle: OpenCode MCP 配置指南\ntags: [mcp]\ndate: 2026-06-07\n---\nnotebooklm 重新登入 nlm login' },
  { path: '個人學習/llm.md', content: '---\ntitle: LLM Wiki\ndate: 2026-05-24\n---\n向量檢索' },
  { path: 'wiki/k.md', content: '---\ntitle: Karpathy\ndate: 2026-01-01\n---\n人物' },
]);

describe('tokenize', () => {
  it('拉丁詞 + CJK bigram', () => {
    expect(tokenize('notebooklm 登入')).toEqual(['notebooklm', '登入']);
    expect(tokenize('重新登入')).toEqual(['重新', '新登', '登入']);
  });
});

describe('scoreNotes', () => {
  it('依關鍵字命中排序，wiki 也在候選', () => {
    const top = scoreNotes(idx, 'notebooklm 要怎麼重新登入？');
    expect(top[0].path).toBe('好工具推薦/opencode-mcp.md');
  });
  it('全無命中 fallback 最新 3 篇', () => {
    const top = scoreNotes(idx, 'zzzz');
    expect(top.length).toBe(3);
    expect(top[0].date).toBe('2026-06-07');
  });
});

describe('ask', () => {
  it('組 prompt 呼叫 AI 並回答', async () => {
    const kv = mockKV({
      'meta:index': JSON.stringify(idx),
      'shard:好工具推薦': JSON.stringify({ '好工具推薦/opencode-mcp.md': { content: 'nlm login 說明', sha: 's' } }),
      'shard:個人學習': JSON.stringify({ '個人學習/llm.md': { content: '向量', sha: 's' } }),
      'shard:wiki': JSON.stringify({ 'wiki/k.md': { content: '人物', sha: 's' } }),
    });
    const run = vi.fn(async (_m: string, input: { messages: { role: string; content: string }[] }) => {
      expect(input.messages[0].role).toBe('system');
      expect(input.messages[0].content).toContain('nlm login 說明');
      expect(input.messages[1]).toEqual({ role: 'user', content: 'notebooklm 怎麼登入' });
      return { response: '執行 nlm login' };
    });
    const answer = await ask({ NOTES: kv, AI: { run } as never, AI_MODEL: 'm' }, 'notebooklm 怎麼登入');
    expect(answer).toBe('執行 nlm login');
    expect(run).toHaveBeenCalledWith('m', expect.anything());
  });
});
