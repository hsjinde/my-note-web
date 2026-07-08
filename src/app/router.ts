export type Route =
  | { page: 'home' }
  | { page: 'article'; path: string }
  | { page: 'tag'; tag: string }
  | { page: 'db' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h.startsWith('/note/')) return { page: 'article', path: decodeURIComponent(h.slice('/note/'.length)) };
  if (h.startsWith('/tag/')) return { page: 'tag', tag: decodeURIComponent(h.slice('/tag/'.length)) };
  if (h === '/db') return { page: 'db' };
  return { page: 'home' };
}
