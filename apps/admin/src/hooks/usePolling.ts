import { useEffect, useRef } from 'react';
import { createPollingController } from './pollingController';

export function shouldRunPolling(enabled: boolean, hidden: boolean, focused: boolean, executing: boolean): boolean {
  return enabled && !hidden && focused && !executing;
}

interface UsePollingOptions {
  callback: (signal: AbortSignal) => Promise<void>;
  intervalMs?: number;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export function usePolling({ callback, intervalMs = 8000, enabled = true, onError }: UsePollingOptions) {
  const latest = useRef({ callback, onError });
  useEffect(() => { latest.current = { callback, onError }; }, [callback, onError]);

  useEffect(() => {
    if (!enabled) return;
    let focused = typeof document.hasFocus !== 'function' || document.hasFocus();
    const poller = createPollingController({
      callback: (signal) => latest.current.callback(signal),
      onError: (error) => latest.current.onError?.(error),
      intervalMs,
      canRun: () => shouldRunPolling(enabled, document.hidden, focused, false),
    });
    const pause = () => { focused = false; poller.pause(); };
    const resume = () => { focused = true; if (!document.hidden) poller.resume(); };
    const visibility = () => {
      if (document.hidden) pause();
      else if (typeof document.hasFocus !== 'function' || document.hasFocus()) resume();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    poller.resume();
    return () => {
      poller.dispose();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
    };
  }, [enabled, intervalMs]);
}
