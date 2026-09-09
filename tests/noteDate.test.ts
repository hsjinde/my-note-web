import { describe, it, expect } from 'vitest';
import { noteDate } from '../src/app/noteDate';
import type { NoteMeta } from '../src/shared/types';

const note = (date: string | null, updatedAt: string | null): NoteMeta => ({
  path: 'a.md', title: 'a', folder: '', tags: [], date, updatedAt,
  excerpt: '', links: [], linksTo: [], private: false,
});

describe('noteDate', () => {
  it('有內容變更時間就用它', () => {
    expect(noteDate(note('2026-06-01', '2026-09-02'))).toBe('2026-09-02');
  });
  it('沒有變更時間才退回 frontmatter 日期', () => {
    expect(noteDate(note('2026-06-01', null))).toBe('2026-06-01');
  });
  it('兩者都沒有時回空字串，讓排序與顯示都不會爆', () => {
    expect(noteDate(note(null, null))).toBe('');
  });
});
