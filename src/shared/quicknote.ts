export const QUICKNOTE_PATH = '靈感/隨手靈感.md';

const TEMPLATE = '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n';

const ENTRY_LINE = /^- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] .+$/;

export function formatTaipeiTimestamp(date: Date): string {
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${taipei.getUTCFullYear()}-${pad(taipei.getUTCMonth() + 1)}-${pad(taipei.getUTCDate())} ${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}`;
}

export function appendQuicknote(existing: string | null, text: string, timestamp: string): string {
  const line = `- [${timestamp}] ${text}`;
  if (existing == null) return `${TEMPLATE}${line}\n`;
  return `${existing.replace(/\n*$/, '\n')}${line}\n`;
}

export function recentQuicknotes(content: string, limit = 5): string[] {
  const entries = content.split('\n').filter((line) => ENTRY_LINE.test(line));
  return entries.slice(-limit).reverse();
}
