import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import { NormalizedApiError, NetworkError } from '../api/types';
import type { ErrorCode } from '../api/types';
import { createPollingController } from '../hooks/pollingController';

const error = (status: number, code: string, retryAfterSeconds?: number) => new NormalizedApiError({
  status, code: code as ErrorCode, retryAfterSeconds, message: code,
});

describe('polling request scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('preserves Retry-After across pause/focus and creates only one timer', async () => {
    const callback = vi.fn().mockRejectedValueOnce(error(429, 'RATE_LIMITED', 45)).mockResolvedValue(undefined);
    const poller = createPollingController({ callback, canRun: () => true, intervalMs: 8000 });
    poller.resume();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8000);
    poller.pause();
    poller.resume(); poller.resume(); poller.resume();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(36_999);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(2);
    poller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off repeated 503s and respects their server deadline', async () => {
    const callback = vi.fn().mockRejectedValueOnce(error(503, 'PROVIDER_UNAVAILABLE', 40))
      .mockRejectedValueOnce(error(503, 'PROVIDER_UNAVAILABLE')).mockResolvedValue(undefined);
    const poller = createPollingController({ callback, canRun: () => true, intervalMs: 8000 });
    poller.resume();
    await vi.advanceTimersByTimeAsync(39_999);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(31_999);
    expect(callback).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(3);
    poller.dispose();
  });

  it.each(['AI_BUDGET_EXCEEDED', 'BUDGET_EXCEEDED', 'CIRCUIT_OPEN'])('suspends %s without focus-triggered retry', async (code) => {
    const callback = vi.fn().mockRejectedValue(error(503, code));
    const poller = createPollingController({ callback, canRun: () => true, intervalMs: 8000 });
    poller.resume();
    await vi.advanceTimersByTimeAsync(0);
    poller.pause(); poller.resume();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    poller.dispose();
  });

  it('never overlaps an in-flight request, and never reschedules after disposal', async () => {
    let finish!: () => void;
    const callback = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const poller = createPollingController({ callback, canRun: () => true, intervalMs: 8000 });
    poller.resume();
    await vi.advanceTimersByTimeAsync(0);
    poller.resume();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(callback).toHaveBeenCalledTimes(1);
    const signal = callback.mock.calls[0][0] as AbortSignal;
    poller.dispose();
    expect(signal.aborted).toBe(true);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from network failure and returns to the normal interval', async () => {
    const callback = vi.fn().mockRejectedValueOnce(new NetworkError()).mockResolvedValue(undefined);
    const poller = createPollingController({ callback, canRun: () => true, intervalMs: 8000 });
    poller.resume();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(callback).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(callback).toHaveBeenCalledTimes(3);
    poller.dispose();
  });

  it('does not turn a very long Retry-After into an immediate retry', async () => {
    const callback = vi.fn().mockRejectedValue(error(429, 'RATE_LIMITED', 3_000_000));
    const poller = createPollingController({ callback, canRun: () => true, intervalMs: 8000 });
    poller.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callback).toHaveBeenCalledTimes(1);
    poller.dispose();
  });

  it.each([429, 503])('reads HTTP-date Retry-After for HTTP %s without logout', async (status) => {
    const onAuthExpired = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', message: 'Unavailable',
    } }), { status, headers: { 'Retry-After': 'Mon, 05 Oct 2026 00:00:45 GMT' } })));
    const client = new ApiClient({ baseUrl: 'http://api.test/v1', onAuthExpired });
    await expect(client.request('/conversations')).rejects.toMatchObject({ status, retryAfterSeconds: 45 });
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it.each(['-1', '1.5', '45seconds', 'invalid'])('rejects malformed Retry-After %s', async (header) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': header } })));
    await expect(new ApiClient({ baseUrl: 'http://api.test/v1' }).request('/conversations'))
      .rejects.toMatchObject({ retryAfterSeconds: undefined });
  });
});
