import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderMarkdown(
  source: string, resolve: (target: string) => string | null,
): { html: string; toc: { level: 2 | 3; text: string; id: string }[] } {
  let body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  body = body.replace(/^(>\s*)\[!\w+\]\s*(.*)$/gm, (_, p: string, rest: string) =>
    rest ? `${p}**${rest}**` : p.trimEnd());

  const placeholders: string[] = [];
  body = body.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, _a, alias?: string) => {
    const label = alias ?? target.trim();
    const path = resolve(target.trim());
    placeholders.push(path
      ? `<a class="wikilink" href="#/note/${encodeURIComponent(path)}">${esc(label)}</a>`
      : `<span class="broken-link">${esc(label)}</span>`);
    return `WIKI${placeholders.length - 1}`;
  });

  const env = {};
  const tokens = md.parse(body, env);
  const toc: { level: 2 | 3; text: string; id: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && (t.tag === 'h2' || t.tag === 'h3')) {
      const text = tokens[i + 1]?.children?.map((c) => c.content).join('') ?? '';
      const id = 'h-' + text.trim().replace(/\s+/g, '-');
      t.attrSet('id', id);
      toc.push({ level: t.tag === 'h2' ? 2 : 3, text: text.trim(), id });
    }
  }
  let html = md.renderer.render(tokens, md.options, env);
  html = html.replace(/WIKI(\d+)/g, (_, i: string) => placeholders[Number(i)]);
  return { html, toc };
}
