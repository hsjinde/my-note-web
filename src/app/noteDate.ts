import type { NoteMeta } from '../shared/types';

// 顯示與排序用的日期：優先用內容實際變更時間（KV 記錄），
// 沒有才退回筆記自己寫的 frontmatter 日期。
export const noteDate = (n: NoteMeta): string => n.updatedAt ?? n.date ?? '';
