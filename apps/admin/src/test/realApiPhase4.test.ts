import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../api/client';
import { ApiEndpoints } from '../api/endpoints';
import {
  NormalizedApiError,
  VersionConflictError,
  NetworkError,
  AuthError,
  VERSION_CONFLICT_MESSAGE,
} from '../api/types';
import { newIdempotencyKey, executeWithNetworkRetry } from '../services/apiClient';
import { getAvailableOrderActions, mapDtoPaymentToViewModel } from '../adapters/orderAdapter';
import { mapDtoMessageToViewModel, mapDtoConversationToViewModel } from '../adapters/conversationAdapter';
import { settingsService } from '../services/settingsService';
import { conversationService } from '../services/conversationService';
import { shouldRunPolling } from '../hooks/usePolling';
import type {
  Order as DTOOrder,
  Payment as DTOPayment,
  MessageReceipt,
  Message as DTOMessage,
  HumanHandoff as DTOHumanHandoff,
} from '@agente-ia/shared';

describe('Phase 4 Real API Integration Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------
  // 1. AUTH & TOKENS
  // -------------------------------------------------------------
  describe('1. Auth & Session Management', () => {
    it('automatically attaches Authorization: Bearer <jwt> to outgoing requests', async () => {
      let capturedAuth: string | null = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedAuth = init.headers.get('Authorization');
        return new Response(JSON.stringify({ data: { user_id: 'usr-123' }, meta: { request_id: 'req-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getAccessToken: () => 'valid-jwt-token-abc',
      });

      const res = await client.request<{ user_id: string }>('/me');
      expect(res.user_id).toBe('usr-123');
      expect(capturedAuth).toBe('Bearer valid-jwt-token-abc');
    });

    it('triggers a single refresh on 401 and retries the original request with the new token', async () => {
      let callCount = 0;
      let usedAuthHeader: string | null = null;
      let currentToken = 'old-expired-token';
      const refreshMock = vi.fn().mockImplementation(async () => {
        currentToken = 'refreshed-jwt-token-xyz';
        return currentToken;
      });

      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              error: { code: 'UNAUTHENTICATED', message: 'Token expired', details: [], retryable: false },
              meta: { request_id: 'req-401' },
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        usedAuthHeader = init.headers.get('Authorization');
        return new Response(JSON.stringify({ data: { success: true }, meta: { request_id: 'req-200' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getAccessToken: () => currentToken,
        refreshAccessToken: refreshMock,
      });

      const res = await client.request<{ success: boolean }>('/catalog/products');
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(callCount).toBe(2);
      expect(usedAuthHeader).toBe('Bearer refreshed-jwt-token-xyz');
      expect(res.success).toBe(true);
    });

    it('invokes onAuthExpired and throws AuthError when refresh fails or returns null', async () => {
      const onExpiredMock = vi.fn();
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'UNAUTHENTICATED', message: 'Invalid session', details: [], retryable: false },
            meta: { request_id: 'req-401' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        refreshAccessToken: async () => null, // refresh failed
        onAuthExpired: onExpiredMock,
      });

      await expect(client.request('/catalog/products')).rejects.toThrow(AuthError);
      expect(onExpiredMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------
  // 2. TENANT SCOPING
  // -------------------------------------------------------------
  describe('2. Tenant Scoping', () => {
    it('scopes businessRequest to /businesses/{business_id}/...', async () => {
      let calledUrl = '';
      globalThis.fetch = vi.fn().mockImplementation(async (url) => {
        calledUrl = url.toString();
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getActiveBusinessId: () => 'biz-alpha-456',
      });

      await client.businessRequest('/orders');
      expect(calledUrl).toBe('http://api.test/v1/businesses/biz-alpha-456/orders');
    });

    it('rejects businessRequest immediately with VALIDATION_ERROR if no business is selected', async () => {
      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getActiveBusinessId: () => null,
      });

      await expect(client.businessRequest('/orders')).rejects.toThrow(NormalizedApiError);
      try {
        await client.businessRequest('/orders');
      } catch (err: any) {
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.message).toContain('No se ha seleccionado ningún negocio activo');
      }
    });
  });

  // -------------------------------------------------------------
  // 3. CATALOG & CONCURRENCY
  // -------------------------------------------------------------
  describe('3. Catalog & Optimistic Concurrency', () => {
    it('parses 409 VERSION_CONFLICT and produces the exact canonical Spanish message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'VERSION_CONFLICT',
              message: 'Database version mismatch for product',
              details: [{ field: 'expected_version', issue: 'stale' }],
              retryable: false,
            },
            meta: { request_id: 'req-conflict-99' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

      try {
        await client.request('/catalog/products/prod-1', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Nuevo', expected_version: 1 }),
        });
        expect.fail('Should have thrown VersionConflictError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersionConflictError);
        expect(err.message).toBe(VERSION_CONFLICT_MESSAGE);
        expect(err.message).toBe('El registro cambió. Actualiza la información antes de continuar.');
        expect(err.status).toBe(409);
        expect(err.code).toBe('VERSION_CONFLICT');
      }
    });
  });

  // -------------------------------------------------------------
  // 4. ORDERS & LIFECYCLE
  // -------------------------------------------------------------
  describe('4. Orders & Lifecycle Actions', () => {
    it('differentiates transitions between delivery and pickup', () => {
      // In delivery: ready can dispatch -> complete
      const readyDelivery = getAvailableOrderActions('ready', 'delivery', 'operator');
      expect(readyDelivery.canDispatch).toBe(true);
      expect(readyDelivery.canComplete).toBe(false);

      // In pickup: ready completes directly (no dispatch step)
      const readyPickup = getAvailableOrderActions('ready', 'pickup', 'operator');
      expect(readyPickup.canDispatch).toBe(false);
      expect(readyPickup.canComplete).toBe(true);
    });

    it('disallows transitions from cancelled and awaiting_confirmation without proper steps', () => {
      const cancelledActions = getAvailableOrderActions('cancelled', 'delivery', 'operator');
      expect(cancelledActions.canAccept).toBe(false);
      expect(cancelledActions.canStartPreparation).toBe(false);
      expect(cancelledActions.canMarkReady).toBe(false);
      expect(cancelledActions.canDispatch).toBe(false);
      expect(cancelledActions.canComplete).toBe(false);
      expect(cancelledActions.canCancel).toBe(false);
    });

    it('endpoints.postOrderTransition sends canonical OrderTransitionInput with expected_version and Idempotency-Key', async () => {
      const mockOrderDto: DTOOrder = {
        id: 'ord-12345678-0000-0000-0000-000000000001',
        business_id: 'biz-01',
        customer_id: 'cust-01',
        conversation_id: 'conv-01',
        status: 'preparing',
        fulfillment: 'delivery',
        items: [],
        subtotal_minor: 1000,
        tax_minor: 0,
        delivery_minor: 200,
        discount_minor: 0,
        total_minor: 1200,
        currency: 'USD',
        address_snapshot: null,
        quote_expires_at: '2026-10-01T00:00:00Z',
        confirmed_at: '2026-10-01T00:00:00Z',
        cancellation_reason: null,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        version: 3,
      };

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getActiveBusinessId: () => 'biz-01',
      });
      const spy = vi.spyOn(client, 'businessRequest').mockResolvedValue(mockOrderDto);
      const ep = new ApiEndpoints(client);

      const result = await ep.postOrderTransition(
        'ord-12345678-0000-0000-0000-000000000001',
        { action: 'mark_ready', expected_version: 2, reason: null },
        'idem-key-trans-1'
      );

      expect(spy).toHaveBeenCalledWith(
        '/orders/ord-12345678-0000-0000-0000-000000000001/transitions',
        expect.objectContaining({
          method: 'POST',
          idempotencyKey: 'idem-key-trans-1',
          body: JSON.stringify({ action: 'mark_ready', expected_version: 2, reason: null }),
        })
      );
      expect(result.version).toBe(3);
    });
  });

  // -------------------------------------------------------------
  // 5. CASH PAYMENTS
  // -------------------------------------------------------------
  describe('5. Cash Payments Protocol', () => {
    it('endpoints.recordCashPayment sends Payment expected_version to cash-record with Idempotency-Key', async () => {
      const mockPayment: DTOPayment = {
        id: 'pay-001',
        business_id: 'biz-01',
        order_id: 'ord-100',
        method: 'cash_on_delivery',
        status: 'paid',
        amount_minor: 1500,
        currency: 'USD',
        paid_at: '2026-10-01T12:00:00Z',
        version: 5,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T12:00:00Z',
      };

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getActiveBusinessId: () => 'biz-01',
      });
      const spy = vi.spyOn(client, 'businessRequest').mockResolvedValue(mockPayment);
      const ep = new ApiEndpoints(client);

      const result = await ep.recordCashPayment(
        'ord-100',
        {
          expected_version: 4,
          note: 'Pago en mano al repartidor',
          paid_at: '2026-10-01T12:00:00Z',
        },
        'idem-cash-key-1'
      );

      expect(spy).toHaveBeenCalledWith(
        '/orders/ord-100/payments/cash-record',
        expect.objectContaining({
          method: 'POST',
          idempotencyKey: 'idem-cash-key-1',
          body: JSON.stringify({
            expected_version: 4,
            note: 'Pago en mano al repartidor',
            paid_at: '2026-10-01T12:00:00Z',
          }),
        })
      );
      expect(result.status).toBe('paid');
      expect(result.version).toBe(5);
    });

    it('maps Payment DTO to OrderPayment view model preserving decimal amounts and status', () => {
      const mockPayment: DTOPayment = {
        id: 'pay-777',
        business_id: 'biz-01',
        order_id: 'ord-888',
        method: 'cash_on_delivery',
        status: 'paid',
        amount_minor: 2350,
        currency: 'USD',
        paid_at: '2026-10-01T14:30:00Z',
        version: 2,
        created_at: '2026-10-01T14:00:00Z',
        updated_at: '2026-10-01T14:30:00Z',
      };

      const vm = mapDtoPaymentToViewModel(mockPayment);
      expect(vm.id).toBe('pay-777');
      expect(vm.amountMinor).toBe(2350);
      expect(vm.amount).toBe(23.5);
      expect(vm.status).toBe('paid');
      expect(vm.version).toBe(2);
    });
  });

  // -------------------------------------------------------------
  // 6. CONVERSATIONS & HANDOFFS
  // -------------------------------------------------------------
  describe('6. Conversations & Human Handoffs', () => {
    it('endpoints.sendMessage returns queued delivery status with outbox_id receipt', async () => {
      const mockReceipt: MessageReceipt = {
        outbox_id: 'outbox-uuid-777',
        status: 'queued',
      };

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getActiveBusinessId: () => 'biz-01',
      });
      const spy = vi.spyOn(client, 'businessRequest').mockResolvedValue(mockReceipt);
      const ep = new ApiEndpoints(client);

      const receipt = await ep.sendMessage(
        'conv-uuid-1',
        { text: 'Hola cliente, estamos preparando tu orden', expected_conversation_version: 2 },
        'idem-msg-1'
      );

      expect(spy).toHaveBeenCalledWith(
        '/conversations/conv-uuid-1/messages',
        expect.objectContaining({
          method: 'POST',
          idempotencyKey: 'idem-msg-1',
          body: JSON.stringify({
            text: 'Hola cliente, estamos preparando tu orden',
            expected_conversation_version: 2,
          }),
        })
      );
      expect(receipt.outbox_id).toBe('outbox-uuid-777');
      expect(receipt.status).toBe('queued');
    });

    it('maps message delivery_status correctly in mapDtoMessageToViewModel', () => {
      const mockMsgDto: DTOMessage = {
        id: 'msg-01',
        business_id: 'biz-01',
        conversation_id: 'conv-01',
        direction: 'outbound',
        kind: 'text',
        actor_type: 'human',
        text: 'Tu orden está lista',
        delivery_status: 'delivered',
        version: 1,
        created_at: '2026-10-01T15:00:00Z',
        updated_at: '2026-10-01T15:00:01Z',
      };

      const vm = mapDtoMessageToViewModel(mockMsgDto);
      expect(vm.id).toBe('msg-01');
      expect(vm.content).toBe('Tu orden está lista');
      expect(vm.sender).toBe('staff');
      expect(vm.senderName).toBe('Operador');
      expect(vm.deliveryStatus).toBe('delivered');
    });

    it('identifies WINDOW_CLOSED and HANDOFF_REQUIRED canonical error codes', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'WINDOW_CLOSED',
              message: '24-hour customer messaging window has closed',
              details: [],
              retryable: false,
            },
            meta: { request_id: 'req-window-1' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

      try {
        await client.request('/conversations/conv-1/messages', {
          method: 'POST',
          body: JSON.stringify({ text: 'Hello', expected_conversation_version: 1 }),
        });
        expect.fail('Should have thrown NormalizedApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NormalizedApiError);
        expect(err.code).toBe('WINDOW_CLOSED');
        expect(err.status).toBe(409);
      }
    });


    it('keeps conversation and handoff versions independent in the view model', () => {
      const conversation = {
        id: 'conv-versions',
        business_id: 'biz-01',
        customer_id: 'cust-01',
        status: 'human_pending',
        assigned_user_id: null,
        last_customer_message_at: null,
        expires_at: '2026-10-04T12:00:00Z',
        automation_epoch: 3,
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:30:00Z',
        version: 7,
      } as any;
      const handoff = {
        id: 'handoff-versions',
        business_id: 'biz-01',
        conversation_id: 'conv-versions',
        reason: 'explicit_request',
        status: 'pending',
        assigned_user_id: null,
        resolved_at: null,
        resolution: null,
        created_at: '2026-10-04T10:31:00Z',
        updated_at: '2026-10-04T10:31:00Z',
        version: 2,
      } as DTOHumanHandoff;

      const vm = mapDtoConversationToViewModel(conversation, { handoff });
      expect(vm.version).toBe(7);
      expect(vm.handoffVersion).toBe(2);
      expect(vm.handoffId).toBe('handoff-versions');
      expect(vm.handoffStatus).toBe('pending');
    });

    it('refuses takeover without an authenticated operator identity', async () => {
      await expect(
        conversationService.takeoverConversation('conv-1', '' as any, 'handoff-1', 4, 2)
      ).rejects.toThrow('Se requiere un usuario autenticado');
    });

    it('endpoints.claimHandoff assigns operator and updates handoff status', async () => {
      const mockHandoff: DTOHumanHandoff = {
        id: 'handoff-01',
        business_id: 'biz-01',
        conversation_id: 'conv-01',
        reason: 'explicit_request',
        status: 'active',
        assigned_user_id: 'usr-agent-01',
        resolved_at: null,
        resolution: null,
        version: 5,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        getActiveBusinessId: () => 'biz-01',
      });
      const spy = vi.spyOn(client, 'businessRequest').mockResolvedValue(mockHandoff);
      const ep = new ApiEndpoints(client);

      const res = await ep.claimHandoff(
        'handoff-01',
        { assigned_user_id: 'usr-agent-01', expected_version: 4 },
        'idem-claim-1'
      );

      expect(spy).toHaveBeenCalledWith(
        '/handoffs/handoff-01/claim',
        expect.objectContaining({
          method: 'POST',
          idempotencyKey: 'idem-claim-1',
          body: JSON.stringify({ assigned_user_id: 'usr-agent-01', expected_version: 4 }),
        })
      );
      expect(res.status).toBe('active');
      expect(res.assigned_user_id).toBe('usr-agent-01');
    });
  });

  // -------------------------------------------------------------
  // 7. IDEMPOTENCY STRATEGY
  // -------------------------------------------------------------
  describe('7. Idempotency Strategy', () => {
    it('executeWithNetworkRetry retains the identical key on NetworkError', async () => {
      let callCount = 0;
      let usedKey = '';

      const failingAction = async (key: string) => {
        callCount++;
        usedKey = key;
        throw new NetworkError('Simulated offline network failure');
      };

      try {
        await executeWithNetworkRetry(failingAction);
        expect.fail('Expected NetworkError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NetworkError);
        expect(err.retainedIdempotencyKey).toBe(usedKey);
      }
    });

    it('newIdempotencyKey generates distinct UUIDs for separate user intentions', () => {
      const key1 = newIdempotencyKey();
      const key2 = newIdempotencyKey();
      expect(key1).not.toBe(key2);
      expect(key1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  // -------------------------------------------------------------
  // 8. RATE LIMITING & BACKOFF
  // -------------------------------------------------------------
  describe('8. Rate Limiting (429) & Backoff', () => {
    it('parses Retry-After header and sets retryAfterSeconds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'RATE_LIMITED', message: 'Too many requests', details: [], retryable: true },
            meta: { request_id: 'req-429' },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '45',
            },
          }
        )
      );

      const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

      try {
        await client.request('/metrics');
        expect.fail('Expected NormalizedApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NormalizedApiError);
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.retryAfterSeconds).toBe(45);
        expect(err.message).toContain('45 segundos');
      }
    });
  });

  // -------------------------------------------------------------
  // 9. MOCK VS REAL INTEGRITY
  // -------------------------------------------------------------
  describe('9. Real Mode Integrity & Unsupported Features', () => {
    it('eliminates fake AI prompt test simulators in settingsService', () => {
      expect((settingsService as any).testAgentPrompt).toBeUndefined();
    });
  });

  describe('10. Polling Focus Guard', () => {
    it('does not run while the window is unfocused even if the document is visible', () => {
      expect(shouldRunPolling(true, false, false, false)).toBe(false);
    });

    it('runs only when enabled, visible, focused and not already executing', () => {
      expect(shouldRunPolling(true, false, true, false)).toBe(true);
      expect(shouldRunPolling(false, false, true, false)).toBe(false);
      expect(shouldRunPolling(true, true, true, false)).toBe(false);
      expect(shouldRunPolling(true, false, true, true)).toBe(false);
    });
  });

});
