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
  it('fenced 區塊包上 code-block wrapper，有語言才掛 data-lang', () => {
    const withLang = renderMarkdown('```ts\nconst a = 1;\n```', resolve);
    expect(withLang.html).toContain('<div class="code-block" data-lang="ts">');
    expect(withLang.html).toContain('class="language-ts"');
    const noLang = renderMarkdown('```\nplain\n```', resolve);
    expect(noLang.html).toContain('<div class="code-block">');
    expect(noLang.html).not.toContain('data-lang');
  });
  it('標了語言的區塊會上色，token 包成 hljs class', () => {
    const { html } = renderMarkdown('```python\ndef f(x):\n    return "ok"  # 註解\n```', resolve);
    expect(html).toContain('<div class="code-block" data-lang="python">');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
    expect(html).toContain('hljs-comment');
  });
  it('fence info 的雜訊尾綴（python!／pyhon=）正規化後照樣上色', () => {
    for (const info of ['python!', 'python=', 'pyhon=']) {
      const { html } = renderMarkdown(`\`\`\`${info}\nimport os\n\`\`\``, resolve);
      expect(html).toContain('hljs-keyword');
    }
    // 標籤照抄筆記寫的（去掉雜訊尾綴），不會被改寫成別名的全名
    expect(renderMarkdown('```python!\nimport os\n```', resolve).html).toContain('data-lang="python"');
    const short = renderMarkdown('```PY\nimport os\n```', resolve).html;
    expect(short).toContain('data-lang="py"');
    expect(short).toContain('hljs-keyword');
  });
  it('不認得的語言（mermaid）保留標籤但不上色，內容照常 escape', () => {
    const { html } = renderMarkdown('```mermaid\ngraph TD; A-->B & <x>\n```', resolve);
    expect(html).toContain('data-lang="mermaid"');
    expect(html).not.toContain('hljs-');
    expect(html).toContain('&lt;x&gt;');
  });
  it('沒標語言：像程式碼的會自動上色，純文字維持原樣', () => {
    const code = renderMarkdown(
      '```\nclass Solution:\n    def isAnagram(self, s: str, t: str) -> bool:\n'
      + '        return sorted(s) == sorted(t)\n```',
      resolve,
    );
    expect(code.html).toContain('hljs-');
    expect(code.html).not.toContain('data-lang');
    const prose = renderMarkdown('```\n這是一段純文字說明，不是程式碼。\n```', resolve);
    expect(prose.html).not.toContain('hljs-');
  });
  it('fence info 夾帶 HTML 時不會注入標記', () => {
    const { html } = renderMarkdown('```"><img src=x onerror=alert(1)>\nx\n```', resolve);
    expect(html).toContain('<div class="code-block">');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
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
