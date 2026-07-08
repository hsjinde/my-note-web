import { describe, it, expect } from 'vitest';
import { verifyGithubSignature } from '../src/worker/webhook';

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyGithubSignature', () => {
  it('正確簽章通過', async () => {
    const body = '{"ref":"refs/heads/main"}';
    expect(await verifyGithubSignature('whsec', body, await sign('whsec', body))).toBe(true);
  });
  it('錯誤 secret / 竄改 body / 缺 header 皆失敗', async () => {
    const body = '{"a":1}';
    const good = await sign('whsec', body);
    expect(await verifyGithubSignature('other', body, good)).toBe(false);
    expect(await verifyGithubSignature('whsec', '{"a":2}', good)).toBe(false);
    expect(await verifyGithubSignature('whsec', body, undefined)).toBe(false);
    expect(await verifyGithubSignature('whsec', body, 'sha256=zz')).toBe(false);
  });
});
