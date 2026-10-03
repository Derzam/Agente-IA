import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function safeTokenEqual(received: string, expected: string): boolean {
  // Fixed-length digests avoid an early return based on secret length.
  return timingSafeEqual(createHash('sha256').update(received).digest(), createHash('sha256').update(expected).digest());
}
export function verifySignature(rawBody: Buffer, signature: unknown, secret: string): boolean {
  if (typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
