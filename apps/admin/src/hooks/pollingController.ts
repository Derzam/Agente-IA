import { NormalizedApiError, NetworkError, TimeoutError } from '@/api/types';

interface PollingOptions {
  callback: (signal: AbortSignal) => Promise<void>;
  canRun: () => boolean;
  intervalMs: number;
  onError?: (error: unknown) => void;
}

/** One timer and one request; pause preserves server deadlines. */
export function createPollingController(options: PollingOptions) {
  let disposed = false;
  let suspended = false;
  let running: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextRunAt = 0;
  let failures = 0;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const resume = () => {
    clearTimer();
    if (disposed || suspended || running || !options.canRun()) return;
    const wait = Math.min(Math.max(0, nextRunAt - Date.now()), 2_147_483_647);
    timer = setTimeout(tick, wait);
  };
  const tick = async () => {
    timer = undefined;
    if (disposed || suspended || running || !options.canRun()) return;
    if (Date.now() < nextRunAt) { resume(); return; }
    const controller = new AbortController();
    running = controller;
    let delay = options.intervalMs;
    try {
      await options.callback(controller.signal);
      failures = 0;
    } catch (error: unknown) {
      if (!controller.signal.aborted && !disposed) {
        options.onError?.(error);
        const apiError = error instanceof NormalizedApiError ? error : null;
        const code = apiError?.code as string | undefined;
        if (code === 'AI_BUDGET_EXCEEDED' || code === 'BUDGET_EXCEEDED' || code === 'CIRCUIT_OPEN') {
          suspended = true;
        } else if (apiError?.status === 429) {
          delay = Math.max(options.intervalMs, (apiError.retryAfterSeconds ?? 30) * 1000);
        } else if (error instanceof NetworkError || error instanceof TimeoutError || apiError?.status === 503) {
          failures += 1;
          delay = Math.min(60_000, options.intervalMs * 2 ** Math.min(failures, 3));
          delay += Math.floor(Math.random() * 1000);
          delay = Math.max(delay, (apiError?.retryAfterSeconds ?? 0) * 1000);
        }
      }
    } finally {
      running = null;
      if (!controller.signal.aborted) nextRunAt = Date.now() + delay;
      resume();
    }
  };
  return {
    resume,
    pause() { clearTimer(); running?.abort(); },
    dispose() { disposed = true; clearTimer(); running?.abort(); },
  };
}
