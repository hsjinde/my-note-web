export function mockKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async (opts: { prefix?: string } = {}) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((name) => ({ name })),
      list_complete: true,
      cursor: '',
    }),
  } as unknown as KVNamespace & { store: Map<string, string> };
}
