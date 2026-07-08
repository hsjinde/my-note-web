export async function verifyGithubSignature(
  secret: string, rawBody: string, sigHeader: string | undefined | null,
): Promise<boolean> {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const given = sigHeader.slice('sha256='.length).toLowerCase();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expect = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (given.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0;
}
