export interface NoteMeta {
  path: string; // repo 相對路徑，如 '好工具推薦/opencode-mcp.md'
  title: string; // frontmatter.title 或檔名（去 .md）
  folder: string; // 第一層資料夾名
  tags: string[];
  date: string | null; // frontmatter date/updated，'YYYY-MM-DD'
  excerpt: string; // 去 frontmatter/markdown 符號後前 160 字
  links: string[]; // 原始 wikilink 目標字串
  linksTo: string[]; // 解析成功的站內 path
  private: boolean; // wiki/ 為 true
}

export interface SiteIndex {
  notes: NoteMeta[];
  builtAt: string; // ISO 時間
}
