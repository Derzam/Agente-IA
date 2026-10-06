// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';
import { NormalizedApiError, type ErrorCode } from '../api/types';
import { usePolling } from '../hooks/usePolling';
import { ConversationsView } from '../features/conversations/ConversationsView';
import { DashboardView } from '../features/dashboard/DashboardView';
import { OrdersView } from '../features/orders/OrdersView';
import { conversationService } from '../services/conversationService';
import { metricsService } from '../services/metricsService';
import { orderService } from '../services/orderService';
import type { ChatMessage, ConversationSummary } from '../types/viewModels';

vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ user: { id: 'operator' } }) }));
vi.mock('../auth/BusinessContext', () => ({ useBusiness: () => ({ activeRole: 'owner' }) }));
vi.mock('../services/conversationService', () => ({ conversationService: { getConversations: vi.fn(), getMessages: vi.fn(), sendMessage: vi.fn() } }));
vi.mock('../services/metricsService', () => ({ metricsService: { getDashboardMetrics: vi.fn() } }));
vi.mock('../services/orderService', () => ({ orderService: { getOrders: vi.fn() } }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const makeError = (code = 'RATE_LIMITED', seconds = 45) => new NormalizedApiError({
  code: code as ErrorCode, status: code === 'RATE_LIMITED' ? 429 : 503,
  message: code, retryAfterSeconds: seconds,
});

describe('runtime component lifecycle and polling integration', () => {
  let root: Root;
  let container: HTMLDivElement;
  const render = async (node: ReactNode) => { await act(async () => { root.render(node); }); };
  const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks();
  });

  it('supports null -> error -> null without changing hook order', async () => {
    await render(<ApiErrorBanner error={null} />);
    await render(<ApiErrorBanner error={makeError()} />);
    expect(container.textContent).toContain('Límite de solicitudes');
    await render(<ApiErrorBanner error={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renews an equal Retry-After on a new error and uses elapsed wall time', async () => {
    const onRetry = vi.fn();
    await render(<ApiErrorBanner error={makeError()} onRetry={onRetry} />);
    await advance(44_000);
    await render(<ApiErrorBanner error={makeError()} onRetry={onRetry} />);
    await advance(1000);
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.textContent).toContain('Espera 44s');
    vi.setSystemTime(Date.now() + 60_000);
    await advance(1000);
    expect(container.querySelector('button')?.disabled).toBe(false);
    await act(async () => { container.querySelector('button')?.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(['AI_BUDGET_EXCEEDED', 'BUDGET_EXCEEDED', 'CIRCUIT_OPEN', 'WINDOW_CLOSED'])('prioritizes %s over generic 503 and hides retry', async (code) => {
    await render(<ApiErrorBanner error={makeError(code, 0)} onRetry={vi.fn()} />);
    expect(container.textContent).not.toContain('Proveedor temporalmente no disponible');
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps the same timer and latest callback across rerenders', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    function Harness({ callback }: { callback: (signal: AbortSignal) => Promise<void> }) {
      usePolling({ callback });
      return null;
    }
    await render(<Harness callback={first} />);
    await advance(0);
    await advance(4000);
    await render(<Harness callback={second} />);
    await advance(3999);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await advance(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each(['conversations', 'orders', 'dashboard'])('%s loader propagates 429 and performs one initial load', async (view) => {
    const service = view === 'conversations' ? vi.mocked(conversationService.getConversations)
      : view === 'orders' ? vi.mocked(orderService.getOrders) : vi.mocked(metricsService.getDashboardMetrics);
    service.mockRejectedValue(makeError());
    vi.mocked(orderService.getOrders).mockRejectedValue(makeError());
    vi.mocked(conversationService.getConversations).mockRejectedValue(makeError());
    await render(view === 'conversations' ? <ConversationsView /> : view === 'orders' ? <OrdersView /> : <DashboardView onNavigate={vi.fn()} />);
    await advance(0);
    expect(service).toHaveBeenCalledTimes(1);
    await advance(8000);
    await act(async () => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await advance(36_999);
    expect(service).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(service).toHaveBeenCalledTimes(2);
  });

  it('does not replace the selected chat with a late response from another conversation', async () => {
    const summaries: ConversationSummary[] = ['a', 'b'].map((id) => ({
      id, customerName: `Cliente ${id}`, customerPhone: '***', status: 'human_active',
      lastMessageSnippet: '', lastMessageTime: '', unreadCount: 0,
    }));
    const message = (conversationId: string, content: string): ChatMessage => ({
      id: `msg-${conversationId}`, conversationId, content,
      sender: 'customer', type: 'text', timestamp: '2026-10-05T00:00:00Z',
    });
    let finishOld!: (messages: ChatMessage[]) => void;
    vi.mocked(conversationService.getConversations).mockResolvedValue(summaries);
    vi.mocked(conversationService.getMessages).mockImplementation(async (id) => id === 'a'
      ? new Promise<ChatMessage[]>((resolve) => { finishOld = resolve; })
      : [message('b', 'Mensaje del chat seleccionado')]);
    await render(<ConversationsView />);
    await advance(0);
    const second = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === 'Cliente b');
    expect(second).toBeDefined();
    await act(async () => { second?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Mensaje del chat seleccionado');
    await act(async () => { finishOld([message('a', 'Respuesta obsoleta')]); });
    expect(container.textContent).toContain('Mensaje del chat seleccionado');
    expect(container.textContent).not.toContain('Respuesta obsoleta');
  });

  it.each([false, true])('respects near-bottom=%s at the completion of an in-flight message POST', async (nearBottom) => {
    const summary: ConversationSummary = {
      id: 'scroll-conv', version: 1, customerName: 'Cliente scroll', customerPhone: '***',
      status: 'human_active', lastMessageSnippet: '', lastMessageTime: '', unreadCount: 0,
    };
    const message: ChatMessage = {
      id: 'scroll-message', conversationId: summary.id, content: 'Historial existente',
      sender: 'customer', type: 'text', timestamp: '2026-10-05T00:00:00Z', deliveryStatus: 'delivered',
    };
    let finishSend!: (receipt: ChatMessage) => void;
    vi.mocked(conversationService.getConversations).mockResolvedValue([summary]);
    vi.mocked(conversationService.getMessages).mockResolvedValue([message]);
    vi.mocked(orderService.getOrders).mockResolvedValue([]);
    vi.mocked(conversationService.sendMessage).mockImplementation(() => new Promise((resolve) => { finishSend = resolve; }));
    await render(<ConversationsView />);
    await advance(0);
    const transcript = container.querySelector<HTMLDivElement>('div.overflow-y-auto.space-y-3')!;
    expect(transcript).not.toBeNull();
    Object.defineProperties(transcript, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 200 } });
    transcript.scrollTop = 1000;
    const input = container.querySelector<HTMLInputElement>('form input[type="text"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Mensaje pendiente');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(conversationService.sendMessage).toHaveBeenCalledTimes(1);
    await act(async () => {
      transcript.scrollTop = nearBottom ? 980 : 400;
      transcript.dispatchEvent(new Event('scroll'));
    });
    await act(async () => { finishSend({ ...message, id: 'scroll-receipt', outboxId: 'scroll-outbox', sender: 'staff', content: 'Mensaje pendiente', deliveryStatus: 'queued' }); });
    expect(container.textContent).toContain('Mensaje pendiente');
    expect(transcript.scrollTop).toBe(nearBottom ? 1200 : 400);
  });
});
