import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// U+E000 / U+E001 (Unicode private-use area) fence placeholder indices so no
// literal note text — "WIKI0", a bare number, backticks — can ever collide.
const S = ''; // wikilink slots (restored as HTML after render)
const C = ''; // code slots (restored as markdown before parse)

export function renderMarkdown(
  source: string, resolve: (target: string) => string | null,
): { html: string; toc: { level: 2 | 3; text: string; id: string }[] } {
  let body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // Stash code regions first so neither the callout nor wikilink pass rewrites
  // anything inside a fenced block or inline `code` span.
  const code: string[] = [];
  const stash = (m: string) => { code.push(m); return `${C}${code.length - 1}${C}`; };
  body = body.replace(/```[\s\S]*?```/g, stash);
  body = body.replace(/~~~[\s\S]*?~~~/g, stash);
  body = body.replace(/`[^`\n]+`/g, stash);

  body = body.replace(/^(>\s*)\[!\w+\]\s*(.*)$/gm, (_, p: string, rest: string) =>
    rest ? `${p}**${rest}**` : p.trimEnd());

  const placeholders: string[] = [];
  body = body.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, _a, alias?: string) => {
    const label = alias ?? target.trim();
    const path = resolve(target.trim());
    placeholders.push(path
      ? `<a class="wikilink" href="#/note/${encodeURIComponent(path)}">${esc(label)}</a>`
      : `<span class="broken-link">${esc(label)}</span>`);
    return `${S}${placeholders.length - 1}${S}`;
  });

  // Restore code as raw markdown so it parses (and escapes) normally.
  body = body.replace(new RegExp(`${C}(\\d+)${C}`, 'g'), (_, i: string) => code[Number(i)]);

  const env = {};
  const tokens = md.parse(body, env);
  const toc: { level: 2 | 3; text: string; id: string }[] = [];
  const idCounts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && (t.tag === 'h2' || t.tag === 'h3')) {
      const text = tokens[i + 1]?.children?.map((c) => c.content).join('') ?? '';
      let id = 'h-' + text.trim().replace(/\s+/g, '-');
      const seen = idCounts.get(id) ?? 0;
      idCounts.set(id, seen + 1);
      if (seen) id = `${id}-${seen}`;
      t.attrSet('id', id);
      toc.push({ level: t.tag === 'h2' ? 2 : 3, text: text.trim(), id });
    }
  }
  let html = md.renderer.render(tokens, md.options, env);
  html = html.replace(new RegExp(`${S}(\\d+)${S}`, 'g'), (_, i: string) => placeholders[Number(i)]);
  return { html, toc };
}
