import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// 只註冊 vault 裡真的出現過的語言（加上幾個常見的），不要整包 highlight.js——
// 全量是 900KB 以上，這樣只花掉十幾 KB。
for (const [name, lang] of Object.entries({
  bash, cpp, css, dockerfile, ini, javascript, json, markdown,
  nginx, powershell, python, sql, typescript, xml, yaml,
})) hljs.registerLanguage(name, lang);

// 筆記裡的 fence info 不乾淨：```python!、```python=、```pyhon= 都出現過，
// 還有 ```js / ```sh 這類簡寫。先正規化再查表。
const ALIAS: Record<string, string> = {
  py: 'python', python3: 'python', pyhon: 'python',
  js: 'javascript', jsx: 'javascript', node: 'javascript', mjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  md: 'markdown',
  yml: 'yaml',
  'c++': 'cpp', cxx: 'cpp', cc: 'cpp',
  html: 'xml', svg: 'xml', vue: 'xml',
  env: 'ini', dotenv: 'ini', conf: 'ini', toml: 'ini', cfg: 'ini',
  docker: 'dockerfile',
};

/** fence info 的第一個 token，去掉尾巴的雜訊符號；給標籤與查語言共用。 */
export function normalizeLang(info: string): string {
  const raw = info.trim().split(/\s+/)[0] ?? '';
  const base = raw.toLowerCase().replace(/[!=:;,.]+$/, '');
  return /^[\w+#-]{1,20}$/.test(base) ? base : '';
}

/** 正規化後能對上 highlight.js 的語言名，對不上回空字串（例如 mermaid）。 */
function resolve(info: string): string {
  const base = normalizeLang(info);
  if (!base) return '';
  const name = ALIAS[base] ?? base;
  return hljs.getLanguage(name) ? name : '';
}

// vault 裡有 328 個沒標語言的 fence，多半仍是程式碼，所以沒標的就猜。限制候選
// 語言並設分數門檻，寧可讓它維持純文字，也不要把 shell 輸出或純文字上錯色。
const AUTO = ['python', 'javascript', 'typescript', 'bash', 'json', 'powershell', 'sql', 'yaml', 'xml'];
// 門檻拿站上 40 個真的沒標語言的區塊量過：≥6 分的十塊全是程式碼；4–5 分那一檔
// 混進了「Exmaple 1:」這種說明文字和目錄樹；2–3 分多半是 ASCII 圖與單行指令。
// 寧可讓短片段維持純文字，也不要把說明文字上成程式碼。
const AUTO_MIN_RELEVANCE = 6;

/**
 * 回傳 <code> 的內層 HTML（已 escape 的 hljs 標記），無法上色時回空字串，
 * 交給 markdown-it 自己 escape。
 */
export function highlightCode(code: string, info: string): string {
  const lang = resolve(info);
  try {
    if (lang) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    if (normalizeLang(info)) return ''; // 標了語言但我們不認得（mermaid）：不猜
    const auto = hljs.highlightAuto(code, AUTO);
    return auto.relevance >= AUTO_MIN_RELEVANCE ? auto.value : '';
  } catch {
    return '';
  }
}
