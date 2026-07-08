import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/app/markdown';

const resolve = (t: string) => (t === '筆記B' ? '好工具推薦/b.md' : null);

describe('renderMarkdown', () => {
  it('移除 frontmatter、渲染標題與表格', () => {
    const { html } = renderMarkdown('---\ntitle: X\n---\n## 標題\n\n| a | b |\n|---|---|\n| 1 | 2 |', resolve);
    expect(html).not.toContain('title: X');
    expect(html).toContain('<h2');
    expect(html).toContain('<table>');
  });
  it('wikilink 解析成站內連結、失效變 span', () => {
    const { html } = renderMarkdown('見 [[筆記B|B 別名]] 與 [[不存在]]', resolve);
    expect(html).toContain(`href="#/note/${encodeURIComponent('好工具推薦/b.md')}"`);
    expect(html).toContain('>B 別名</a>');
    expect(html).toContain('<span class="broken-link">不存在</span>');
  });
  it('toc 收集 h2/h3 並加 id', () => {
    const { html, toc } = renderMarkdown('## 甲\n\n### 乙\n\n#### 丙', resolve);
    expect(toc).toEqual([
      { level: 2, text: '甲', id: 'h-甲' },
      { level: 3, text: '乙', id: 'h-乙' },
    ]);
    expect(html).toContain('id="h-甲"');
  });
  it('callout 標記移除', () => {
    const { html } = renderMarkdown('> [!tip] 小技巧\n> 內容', resolve);
    expect(html).not.toContain('[!tip]');
    expect(html).toContain('<blockquote>');
  });
});
