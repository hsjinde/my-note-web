import { describe, it, expect } from 'vitest';
import { isPublicPath, isIndexedPath, parseNote } from '../src/worker/content';

describe('路徑規則', () => {
  it('白名單資料夾的 .md 是公開', () => {
    expect(isPublicPath('個人學習/a.md')).toBe(true);
    expect(isPublicPath('好工具推薦/x/y.md')).toBe(true);
    expect(isPublicPath('工作專案/b.md')).toBe(true);
  });
  it('wiki 與其他資料夾不公開', () => {
    expect(isPublicPath('wiki/entities/k.md')).toBe(false);
    expect(isPublicPath('日常/d.md')).toBe(false);
    expect(isPublicPath('個人學習/img.png')).toBe(false);
  });
  it('AI 索引 = 白名單 + wiki', () => {
    expect(isIndexedPath('wiki/k.md')).toBe(true);
    expect(isIndexedPath('個人學習/a.md')).toBe(true);
    expect(isIndexedPath('日常/d.md')).toBe(false);
  });
});

describe('parseNote', () => {
  const md = `---\ntitle: OpenCode MCP 配置指南\ntags: [tool, mcp]\ndate: 2026-06-07\n---\n\n> 本筆記記錄 OpenCode 已配置的 MCP servers。\n\n見 [[oc-go-cc 設定指南]] 與 [[wiki-page|別名]]。`;
  const meta = parseNote('好工具推薦/opencode-mcp.md', md);
  it('讀 frontmatter', () => {
    expect(meta.title).toBe('OpenCode MCP 配置指南');
    expect(meta.tags).toEqual(['tool', 'mcp']);
    expect(meta.date).toBe('2026-06-07');
    expect(meta.folder).toBe('好工具推薦');
    expect(meta.private).toBe(false);
  });
  it('抓 wikilink 目標', () => {
    expect(meta.links).toEqual(['oc-go-cc 設定指南', 'wiki-page']);
  });
  it('excerpt 去除 markdown 符號', () => {
    expect(meta.excerpt).toContain('本筆記記錄 OpenCode');
    expect(meta.excerpt).not.toContain('>');
    expect(meta.excerpt.length).toBeLessThanOrEqual(160);
  });
  it('無 frontmatter 用檔名當標題、date null', () => {
    const m = parseNote('wiki/k.md', '# 內文');
    expect(m.title).toBe('k');
    expect(m.date).toBeNull();
    expect(m.private).toBe(true);
  });
});
