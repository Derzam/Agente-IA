import { describe, it, expect, vi } from 'vitest';
import { newIdempotencyKey, executeWithNetworkRetry } from '../services/apiClient';
import { NetworkError } from '../api/types';

describe('Idempotency Suite', () => {
  it('generates a new unique UUID for separate user actions', () => {
    const key1 = newIdempotencyKey();
    const key2 = newIdempotencyKey();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    expect(key1).toMatch(uuidRegex);
    expect(key2).toMatch(uuidRegex);
    expect(key1).not.toBe(key2);
  });

  it('retains and reuses the exact same idempotency key during network retry of the same gesture', async () => {
    let attempts = 0;
    const receivedKeys: string[] = [];

    const mockMutationAction = vi.fn().mockImplementation(async (key: string) => {
      attempts++;
      receivedKeys.push(key);
      if (attempts === 1) {
        throw new NetworkError('Failed to fetch: Connection timeout');
      }
      return { success: true };
    });

    let retainedKey: string | undefined;

    // First attempt fails with NetworkError
    try {
      await executeWithNetworkRetry(mockMutationAction);
      expect.fail('Should have thrown NetworkError on first attempt');
    } catch (err: any) {
      expect(err).toBeInstanceOf(NetworkError);
      retainedKey = err.retainedIdempotencyKey;
      expect(retainedKey).toBeTruthy();
    }

    // Caller retries the same user gesture using the retained key
    const secondResult = await executeWithNetworkRetry(mockMutationAction, retainedKey);
    expect(secondResult).toEqual({ success: true });

    // Verify: exact same key was sent on both attempts
    expect(receivedKeys).toHaveLength(2);
    expect(receivedKeys[0]).toBe(receivedKeys[1]);
  });

  it('does NOT reuse key when user initiates a new and different action', async () => {
    const keysUsed: string[] = [];

    const actionA = async (key: string) => {
      keysUsed.push(key);
      return 'action-A-done';
    };

    const actionB = async (key: string) => {
      keysUsed.push(key);
      return 'action-B-done';
    };

    await executeWithNetworkRetry(actionA);
    await executeWithNetworkRetry(actionB);

    expect(keysUsed).toHaveLength(2);
    expect(keysUsed[0]).not.toBe(keysUsed[1]);
  });
});
