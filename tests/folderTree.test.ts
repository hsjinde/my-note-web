import { describe, it, expect } from 'vitest';
import { buildFolderTree } from '../src/app/folderTree';
import type { NoteMeta } from '../src/shared/types';

function note(path: string, folder: string): NoteMeta {
  return { path, title: path, folder, tags: [], date: null, excerpt: '', links: [], linksTo: [], private: false };
}

describe('buildFolderTree', () => {
  const notes = [
    note('個人學習/LeetCode/a.md', '個人學習/LeetCode'),
    note('個人學習/多益/b.md', '個人學習/多益'),
    note('個人學習/c.md', '個人學習'),
    note('好工具推薦/d.md', '好工具推薦'),
    note('工作專案/e.md', '工作專案'),
  ];
  const tree = buildFolderTree(notes);

  it('頂層依 zh-Hant 排序', () => {
    expect(tree.map((n) => n.name)).toEqual(['工作專案', '好工具推薦', '個人學習']);
  });

  it('子資料夾巢狀掛在正確的父節點下，且依 zh-Hant 排序', () => {
    const study = tree.find((n) => n.name === '個人學習')!;
    expect(study.fullPath).toBe('個人學習');
    expect(study.children.map((n) => n.name)).toEqual(['多益', 'LeetCode']);
    expect(study.children[0].fullPath).toBe('個人學習/多益');
    expect(study.children[1].fullPath).toBe('個人學習/LeetCode');
  });

  it('筆記掛在直屬資料夾節點的 notes，不會外溢到其他層', () => {
    const study = tree.find((n) => n.name === '個人學習')!;
    expect(study.notes.map((n) => n.path)).toEqual(['個人學習/c.md']);
    const leetcode = study.children.find((n) => n.name === 'LeetCode')!;
    expect(leetcode.notes.map((n) => n.path)).toEqual(['個人學習/LeetCode/a.md']);
  });
});
