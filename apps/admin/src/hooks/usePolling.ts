import { useEffect, useRef, useCallback } from 'react';
import { NormalizedApiError, NetworkError } from '@/api/types';

interface UsePollingOptions {
  callback: (signal: AbortSignal) => Promise<void>;
  intervalMs?: number;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export function usePolling({
  callback,
  intervalMs = 8000, // 8 seconds, within the 5–10s target
  enabled = true,
  onError,
}: UsePollingOptions) {
  const isExecutingRef = useRef(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const consecutiveNetworkErrorsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffDelayRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const executeTick = useCallback(async () => {
    if (!enabled || document.hidden || isExecutingRef.current) {
      return;
    }

    isExecutingRef.current = true;
    activeAbortControllerRef.current = new AbortController();

    try {
      await callback(activeAbortControllerRef.current.signal);
      consecutiveNetworkErrorsRef.current = 0;
      backoffDelayRef.current = null;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Ignored on deliberate cancellation
        return;
      }

      onError?.(err);

      // 429 Rate Limit backoff
      if (err instanceof NormalizedApiError && err.status === 429) {
        const waitSec = err.retryAfterSeconds || 30;
        backoffDelayRef.current = waitSec * 1000;
      } else if (err instanceof NetworkError) {
        consecutiveNetworkErrorsRef.current += 1;
        // Pause/backoff after consecutive network errors (e.g. 20s, 40s, max 60s)
        const multiplier = Math.min(consecutiveNetworkErrorsRef.current, 3);
        backoffDelayRef.current = intervalMs * multiplier * 2;
      }
    } finally {
      isExecutingRef.current = false;
      activeAbortControllerRef.current = null;

      // Schedule next run if still enabled
      if (enabled && !document.hidden) {
        const delay = backoffDelayRef.current ?? intervalMs;
        clearTimer();
        timerRef.current = setTimeout(executeTick, delay);
      }
    }
  }, [callback, enabled, intervalMs, onError, clearTimer]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      activeAbortControllerRef.current?.abort();
      return;
    }

    // Immediate first execution
    executeTick();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        activeAbortControllerRef.current?.abort();
      } else {
        // Tab gained focus: resume polling immediately
        consecutiveNetworkErrorsRef.current = 0;
        backoffDelayRef.current = null;
        executeTick();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimer();
      activeAbortControllerRef.current?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, executeTick, clearTimer]);
}
