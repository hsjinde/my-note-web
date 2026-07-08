import { describe, it, expect } from 'vitest';
import { createSession, verifySession } from '../src/worker/auth';

describe('session', () => {
  it('簽發後可驗證', async () => {
    const t = await createSession('secret');
    expect(await verifySession(t, 'secret')).toBe(true);
  });
  it('錯誤 secret 驗證失敗', async () => {
    const t = await createSession('secret');
    expect(await verifySession(t, 'other')).toBe(false);
  });
  it('過期 token 失敗', async () => {
    const t = await createSession('secret', Date.now() - 31 * 86400_000);
    expect(await verifySession(t, 'secret')).toBe(false);
  });
  it('竄改 payload 失敗', async () => {
    const t = await createSession('secret');
    const forged = String(Number(t.split('.')[0]) + 99999999) + '.' + t.split('.')[1];
    expect(await verifySession(forged, 'secret')).toBe(false);
  });
  it('空值失敗', async () => {
    expect(await verifySession(undefined, 'secret')).toBe(false);
    expect(await verifySession('garbage', 'secret')).toBe(false);
  });
});
