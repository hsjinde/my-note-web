import { describe, it, expect } from 'vitest';
import { parseHash } from '../src/app/router';

describe('parseHash', () => {
  it('各路由解析', () => {
    expect(parseHash('')).toEqual({ page: 'home' });
    expect(parseHash('#/')).toEqual({ page: 'home' });
    expect(parseHash(`#/note/${encodeURIComponent('個人學習/a.md')}`)).toEqual({ page: 'article', path: '個人學習/a.md' });
    expect(parseHash('#/tag/mcp')).toEqual({ page: 'tag', tag: 'mcp' });
    expect(parseHash('#/db')).toEqual({ page: 'db' });
    expect(parseHash('#/unknown')).toEqual({ page: 'home' });
  });
});
