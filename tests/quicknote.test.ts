import { describe, it, expect } from 'vitest';
import { formatTaipeiTimestamp, appendQuicknote, recentQuicknotes, QUICKNOTE_PATH } from '../src/shared/quicknote';

describe('QUICKNOTE_PATH', () => {
  it('位於靈感資料夾', () => {
    expect(QUICKNOTE_PATH).toBe('靈感/隨手靈感.md');
  });
});

describe('formatTaipeiTimestamp', () => {
  it('把 UTC 時間轉成台灣時間（UTC+8）格式化字串', () => {
    // 2026-07-09T23:30:00Z → 台灣時間 2026-07-10 07:30
    expect(formatTaipeiTimestamp(new Date('2026-07-09T23:30:00Z'))).toBe('2026-07-10 07:30');
  });
  it('補零', () => {
    // 2026-01-05T00:05:00Z → 台灣時間 2026-01-05 08:05
    expect(formatTaipeiTimestamp(new Date('2026-01-05T00:05:00Z'))).toBe('2026-01-05 08:05');
  });
});

describe('appendQuicknote', () => {
  it('檔案不存在時建立範本並加入第一則', () => {
    const result = appendQuicknote(null, '第一個靈感', '2026-07-09 12:00');
    expect(result).toBe(
      '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n- [2026-07-09 12:00] 第一個靈感\n',
    );
  });
  it('既有檔案在結尾 append 一行', () => {
    const existing = '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n- [2026-07-09 12:00] 第一個靈感\n';
    const result = appendQuicknote(existing, '第二個靈感', '2026-07-09 13:00');
    expect(result).toBe(
      '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n- [2026-07-09 12:00] 第一個靈感\n- [2026-07-09 13:00] 第二個靈感\n',
    );
  });
  it('既有檔案結尾沒有換行也能正確 append', () => {
    const existing = '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n- [2026-07-09 12:00] 第一個靈感';
    const result = appendQuicknote(existing, '第二個靈感', '2026-07-09 13:00');
    expect(result).toBe(
      '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n- [2026-07-09 12:00] 第一個靈感\n- [2026-07-09 13:00] 第二個靈感\n',
    );
  });
});

describe('recentQuicknotes', () => {
  it('空內容回傳空陣列', () => {
    expect(recentQuicknotes('')).toEqual([]);
  });
  it('回傳最近 5 則，新的在前', () => {
    const lines = Array.from({ length: 7 }, (_, i) => `- [2026-07-0${i + 1} 12:00] 靈感${i + 1}`);
    const content = '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n' + lines.join('\n') + '\n';
    const result = recentQuicknotes(content);
    expect(result).toEqual([
      '- [2026-07-07 12:00] 靈感7',
      '- [2026-07-06 12:00] 靈感6',
      '- [2026-07-05 12:00] 靈感5',
      '- [2026-07-04 12:00] 靈感4',
      '- [2026-07-03 12:00] 靈感3',
    ]);
  });
  it('少於 5 則時全部回傳，新的在前', () => {
    const content = '---\ntitle: 隨手靈感\n---\n\n# 隨手靈感\n\n- [2026-07-01 12:00] 靈感1\n- [2026-07-02 12:00] 靈感2\n';
    expect(recentQuicknotes(content)).toEqual([
      '- [2026-07-02 12:00] 靈感2',
      '- [2026-07-01 12:00] 靈感1',
    ]);
  });
});
