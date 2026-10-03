import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../api/client';
import { AuthError } from '../api/types';

describe('Auth & Session Flow Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles non-existent session by sending unauthenticated request', async () => {
    let capturedAuth: string | null = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedAuth = init.headers.get('Authorization');
      return new Response(JSON.stringify({ data: { public: true } }), { status: 200 });
    });

    const client = new ApiClient({
      getAccessToken: () => null,
    });

    await client.request('/public-endpoint');
    expect(capturedAuth).toBeNull();
  });

  it('handles 401 with successful single refresh and request retry', async () => {
    let callCount = 0;
    let refreshCount = 0;
    const tokensUsed: (string | null)[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      callCount++;
      const auth = init.headers.get('Authorization');
      tokensUsed.push(auth);

      if (callCount === 1) {
        // First attempt returns 401
        return new Response(
          JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Token expired' } }),
          { status: 401 }
        );
      }
      // Second attempt succeeds with new token
      return new Response(JSON.stringify({ data: { success: true } }), { status: 200 });
    });

    const refreshMock = vi.fn().mockImplementation(async () => {
      refreshCount++;
      return 'new-refreshed-token-999';
    });

    let currentToken = 'expired-token-111';

    const client = new ApiClient({
      getAccessToken: () => currentToken,
      refreshAccessToken: async () => {
        const token = await refreshMock();
        currentToken = token;
        return token;
      },
    });

    const result = await client.request('/protected-resource');
    expect(result).toEqual({ success: true });
    expect(callCount).toBe(2);
    expect(refreshCount).toBe(1);
    expect(tokensUsed[0]).toBe('Bearer expired-token-111');
    expect(tokensUsed[1]).toBe('Bearer new-refreshed-token-999');
  });

  it('handles failed refresh on 401 by clearing session, calling onAuthExpired and avoiding infinite loops', async () => {
    let callCount = 0;
    let onAuthExpiredCalled = false;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Token invalid' } }),
        { status: 401 }
      );
    });

    const client = new ApiClient({
      getAccessToken: () => 'bad-token',
      refreshAccessToken: async () => {
        // Refresh also fails
        return null;
      },
      onAuthExpired: () => {
        onAuthExpiredCalled = true;
      },
    });

    await expect(client.request('/protected')).rejects.toThrow(AuthError);
    expect(callCount).toBe(1); // No infinite retries!
    expect(onAuthExpiredCalled).toBe(true);
  });

  it('avoids infinite retry loop if retried request returns 401 again after refresh', async () => {
    let callCount = 0;
    let onAuthExpiredCalled = false;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      // Always returns 401
      return new Response(
        JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Still invalid' } }),
        { status: 401 }
      );
    });

    const client = new ApiClient({
      getAccessToken: () => 'token-1',
      refreshAccessToken: async () => 'token-2',
      onAuthExpired: () => {
        onAuthExpiredCalled = true;
      },
    });

    await expect(client.request('/protected')).rejects.toThrow(AuthError);
    expect(callCount).toBe(2); // Exactly 1 retry
    expect(onAuthExpiredCalled).toBe(true);
  });
});
