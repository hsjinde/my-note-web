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
  it('同名標題產生不重複的 id，避免錨點/目錄全部跳到第一個', () => {
    const { html, toc } = renderMarkdown('## 概述\n\n內文\n\n## 概述\n\n內文', resolve);
    expect(toc.map((h) => h.id)).toEqual(['h-概述', 'h-概述-1']);
    expect(html).toContain('id="h-概述"');
    expect(html).toContain('id="h-概述-1"');
  });
  it('正文含 WIKI 佔位字樣或裸數字時不被誤當成 wikilink 佔位符', () => {
    const { html } = renderMarkdown('型號 WIKI0 與代號 0，另有 [[筆記B]]', resolve);
    expect(html).toContain('WIKI0');
    expect(html).toContain('代號 0');
    expect(html).toContain(`href="#/note/${encodeURIComponent('好工具推薦/b.md')}"`);
    expect(html).not.toContain('undefined');
  });
  it('程式碼區塊/行內碼內的 [[wikilink]] 保持原字，不被轉成連結', () => {
    const inline = renderMarkdown('用 `[[語法]]` 表示連結，真的連結是 [[筆記B]]', resolve);
    expect(inline.html).toContain('<code>[[語法]]</code>');
    expect(inline.html).toContain('class="wikilink"');
    const fenced = renderMarkdown('```\n[[不存在]]\n```', resolve);
    expect(fenced.html).toContain('[[不存在]]');
    expect(fenced.html).not.toContain('broken-link');
  });
});
