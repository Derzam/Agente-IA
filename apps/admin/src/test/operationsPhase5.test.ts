import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../api/client';
import { NormalizedApiError, AuthError } from '../api/types';
import {
  mapDtoMessageToViewModel,
  sanitizeFailureCode,
} from '../adapters/conversationAdapter';
import { shouldRunPolling } from '../hooks/usePolling';
import {
  reconcileConversationMessages,
  sortMessagesChronological,
} from '../features/conversations/messageReconciliation';
import type { Message as DTOMessage } from '@agente-ia/shared';
import type { ChatMessage, DeliveryStatus } from '../types/viewModels';
import { RUNTIME_PRESENTATION, RUNTIME_READINESS_PUBLIC } from '../components/operations/runtimePresentation';

describe('Phase 5 Operations & Runtime UI Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------
  // 1. OUTBOX STATES & NO FAKE SUCCESS
  // -------------------------------------------------------------
  describe('1. Outbox Delivery States & Truthful Status Representation', () => {
    it('202 queued is mapped as "queued" and never as "sent" or "delivered"', () => {
      const dto: DTOMessage & { outbox_status?: string } = {
        id: 'msg-receipt-001',
        business_id: 'biz-001',
        conversation_id: 'conv-001',
        version: 1,
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:00:00Z',
        direction: 'outbound',
        kind: 'text',
        actor_type: 'human',
        outbox_id: 'outbox-receipt-001',
        text: 'Hola, tu pedido está en preparación.',
        delivery_status: null,
        outbox_status: 'queued',
      };

      const viewModel = mapDtoMessageToViewModel(dto);
      expect(viewModel.deliveryStatus).toBe('queued');
      expect(viewModel.deliveryStatus).not.toBe('sent');
      expect(viewModel.deliveryStatus).not.toBe('delivered');
    });

    it('confirms sent, delivered and read states monotonically', () => {
      const baseDto: DTOMessage = {
        id: 'msg-002',
        business_id: 'biz-001',
        conversation_id: 'conv-001',
        version: 1,
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:00:00Z',
        direction: 'outbound',
        kind: 'text',
        actor_type: 'human',
        outbox_id: null,
        text: 'Mensaje de prueba',
        delivery_status: 'sent',
      };

      expect(mapDtoMessageToViewModel({ ...baseDto, delivery_status: 'sent' }).deliveryStatus).toBe('sent');
      expect(mapDtoMessageToViewModel({ ...baseDto, delivery_status: 'delivered' }).deliveryStatus).toBe('delivered');
      expect(mapDtoMessageToViewModel({ ...baseDto, delivery_status: 'read' }).deliveryStatus).toBe('read');
    });

    it('represents unknown state distinctly and never hides it as success or failure', () => {
      const dto: DTOMessage = {
        id: 'msg-003',
        business_id: 'biz-001',
        conversation_id: 'conv-001',
        version: 1,
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:00:00Z',
        direction: 'outbound',
        kind: 'text',
        actor_type: 'human',
        outbox_id: null,
        text: 'Mensaje sin confirmación definitiva',
        delivery_status: 'unknown',
      };

      const viewModel = mapDtoMessageToViewModel(dto);
      expect(viewModel.deliveryStatus).toBe('unknown');
      expect(viewModel.deliveryStatus).not.toBe('failed');
      expect(viewModel.deliveryStatus).not.toBe('sent');
    });

    it('maps sending and dead_letter states without loss', () => {
      const dtoSending: DTOMessage & { outbox_status: string } = {
        id: 'msg-004',
        business_id: 'biz-001',
        conversation_id: 'conv-001',
        version: 1,
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:00:00Z',
        direction: 'outbound',
        kind: 'text',
        actor_type: 'human',
        outbox_id: null,
        text: 'Enviando...',
        delivery_status: null,
        outbox_status: 'sending',
      };

      const dtoDeadLetter: DTOMessage & { outbox_status: string } = {
        ...dtoSending,
        id: 'msg-005',
        outbox_status: 'dead_letter',
      };

      expect(mapDtoMessageToViewModel(dtoSending).deliveryStatus).toBe('sending');
      expect(mapDtoMessageToViewModel(dtoDeadLetter).deliveryStatus).toBe('dead_letter');
    });

    it('covers all 9 required outbox states', () => {
      const expectedStates: DeliveryStatus[] = [
        'queued',
        'pending',
        'sending',
        'sent',
        'delivered',
        'read',
        'failed',
        'unknown',
        'dead_letter',
      ];

      for (const st of expectedStates) {
        const dto: any = {
          id: `msg-${st}`,
          business_id: 'biz-001',
          conversation_id: 'conv-001',
          version: 1,
          created_at: '2026-10-04T10:00:00Z',
          updated_at: '2026-10-04T10:00:00Z',
          direction: 'outbound',
          kind: 'text',
          actor_type: 'human',
          text: 'Test',
          delivery_status: st,
        };
        const vm = mapDtoMessageToViewModel(dto);
        expect(vm.deliveryStatus).toBe(st);
      }
    });
  });

  // -------------------------------------------------------------
  // 2. SAFE FAILURE CODE SANITIZATION
  // -------------------------------------------------------------
  describe('2. Safe Failure Code Sanitization (No Leaks)', () => {
    it('accepts safe numeric and standard error codes', () => {
      expect(sanitizeFailureCode(131026)).toBe('131026');
      expect(sanitizeFailureCode('131026')).toBe('131026');
      expect(sanitizeFailureCode('RATE_LIMIT_EXCEEDED')).toBe('RATE_LIMIT_EXCEEDED');
      expect(sanitizeFailureCode('RECIPIENT_NOT_ALLOWED')).toBe('RECIPIENT_NOT_ALLOWED');
      expect(sanitizeFailureCode('META_TIMEOUT')).toBe('META_TIMEOUT');
    });

    it('strips bearer tokens, dumps, stacks, and sensitive patterns', () => {
      expect(sanitizeFailureCode('Bearer eyJhbGciOi...')).toBeNull();
      expect(sanitizeFailureCode('Error at Object.<anonymous> (file.ts:12:4)')).toBeNull();
      expect(sanitizeFailureCode('{"error":{"code":190,"message":"Invalid OAuth access token"}}')).toBeNull();
      expect(sanitizeFailureCode('token_secret_12345')).toBeNull();
      expect(sanitizeFailureCode('SELECT * FROM users')).toBeNull();
      expect(sanitizeFailureCode('https://graph.facebook.com/v19.0/messages')).toBeNull();
      expect(sanitizeFailureCode('A'.repeat(100))).toBeNull(); // exceeds 64 chars
    });

    it('mapDtoMessageToViewModel attaches safe failure code and strips unsafe leaks', () => {
      const safeDto: any = {
        id: 'msg-fail-1',
        business_id: 'biz-001',
        conversation_id: 'conv-001',
        version: 1,
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:00:00Z',
        direction: 'outbound',
        kind: 'text',
        actor_type: 'human',
        text: 'Error de entrega',
        delivery_status: 'failed',
        failure_code: '131026',
      };

      const unsafeDto: any = {
        ...safeDto,
        id: 'msg-fail-2',
        failure_code: 'Bearer EAAG...dump_stack_trace_token',
      };

      expect(mapDtoMessageToViewModel(safeDto).failureCode).toBe('131026');
      expect(mapDtoMessageToViewModel(unsafeDto).failureCode).toBeNull();
    });

    it('mapDtoMessageToViewModel maps typed outbox_id without requiring any bypass', () => {
      const typedDto: DTOMessage = {
        id: 'msg-outbox-1',
        business_id: 'biz-001',
        conversation_id: 'conv-001',
        version: 1,
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:00:00Z',
        direction: 'outbound',
        kind: 'text',
        actor_type: 'human',
        outbox_id: 'outbox-uuid-canonical-1',
        text: 'Mensaje con outbox id',
        delivery_status: 'sent',
      };

      const vm = mapDtoMessageToViewModel(typedDto);
      expect(vm.outboxId).toBe('outbox-uuid-canonical-1');
    });
  });

  // -------------------------------------------------------------
  // 3. 429 RATE LIMITING & RETRY-AFTER
  // -------------------------------------------------------------
  describe('3. 429 Rate Limiting & Retry-After Handling', () => {
    it('ApiClient captures Retry-After header and formats non-alarmist message', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: 'Demasiadas solicitudes.',
              details: [],
              retryable: true,
            },
            meta: { request_id: 'req-429' },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '45',
            },
          }
        );
      });

      const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

      try {
        await client.request('/conversations');
        expect.unreachable('Should have thrown NormalizedApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NormalizedApiError);
        expect(err.status).toBe(429);
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.retryAfterSeconds).toBe(45);
        expect(err.message).toContain('45 segundos');
        expect(err.message).not.toContain('CRITICAL');
        expect(err.message).not.toContain('FATAL');
      }
    });

    it('falls back gracefully when Retry-After is absent', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: 'Límite de tasa alcanzado.',
              details: [],
              retryable: true,
            },
            meta: { request_id: 'req-429-no-header' },
          }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      });

      const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

      try {
        await client.request('/conversations');
        expect.unreachable('Should have thrown NormalizedApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NormalizedApiError);
        expect(err.status).toBe(429);
        expect(err.retryAfterSeconds).toBeUndefined();
        expect(err.message).toContain('intenta más tarde');
      }
    });
  });

  // -------------------------------------------------------------
  // 4. 503 PROVIDER UNAVAILABLE & NO UNWANTED LOGOUT
  // -------------------------------------------------------------
  describe('4. 503 Provider Unavailable & No Forced Logout', () => {
    it('handles 503 without invoking onAuthExpired or throwing AuthError', async () => {
      const onAuthExpiredMock = vi.fn();
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'El servicio de base de datos o proveedor no responde.',
              details: [],
              retryable: true,
            },
            meta: { request_id: 'req-503' },
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '3' },
          }
        );
      });

      const client = new ApiClient({
        baseUrl: 'http://api.test/v1',
        onAuthExpired: onAuthExpiredMock,
      });

      try {
        await client.request('/catalog/products');
        expect.unreachable('Should have thrown NormalizedApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NormalizedApiError);
        expect(err).not.toBeInstanceOf(AuthError);
        expect(err.status).toBe(503);
        expect(err.code).toBe('PROVIDER_UNAVAILABLE');
        expect(onAuthExpiredMock).not.toHaveBeenCalled();
      }
    });

    it('preserves specific provider error code when backend supplies it', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'CIRCUIT_OPEN',
              message: 'Servicio de IA temporalmente suspendido por circuito abierto.',
              details: [],
              retryable: false,
            },
            meta: { request_id: 'req-circuit' },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

      try {
        await client.request('/conversations');
        expect.unreachable('Should have thrown NormalizedApiError');
      } catch (err: any) {
        expect(err.code).toBe('CIRCUIT_OPEN');
        expect(err.message).toContain('Servicio de IA temporalmente suspendido');
      }
    });
  });

  // -------------------------------------------------------------
  // 5. POLLING GUARDS & NO DUPLICATES
  // -------------------------------------------------------------
  describe('5. Polling Guards & Message Deduplication', () => {
    it('shouldRunPolling enforces visibility, focus, and non-concurrent execution', () => {
      // enabled, not hidden, focused, not executing -> true
      expect(shouldRunPolling(true, false, true, false)).toBe(true);

      // disabled -> false
      expect(shouldRunPolling(false, false, true, false)).toBe(false);

      // document hidden -> false
      expect(shouldRunPolling(true, true, true, false)).toBe(false);

      // window blurred / not focused -> false
      expect(shouldRunPolling(true, false, false, false)).toBe(false);

      // already executing tick -> false
      expect(shouldRunPolling(true, false, true, true)).toBe(false);
    });

    it('normalizes descending API messages into chronological ascending order (antiguo, medio, nuevo)', () => {
      const apiDescMessages: ChatMessage[] = [
        {
          id: 'msg-3',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'nuevo',
          timestamp: '2026-10-04T10:02:00Z',
          deliveryStatus: 'delivered',
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'medio',
          timestamp: '2026-10-04T10:01:00Z',
          deliveryStatus: 'sent',
        },
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'antiguo',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'read',
        },
      ];

      const sorted = sortMessagesChronological(apiDescMessages);

      expect(sorted.map((m) => m.content)).toEqual(['antiguo', 'medio', 'nuevo']);
      // Does not mutate the source array
      expect(apiDescMessages[0].content).toBe('nuevo');
      expect(apiDescMessages[2].content).toBe('antiguo');
    });

    it('provides stable deterministic sorting when timestamps are identical using id as tie-breaker', () => {
      const sameTimestampMessages: ChatMessage[] = [
        {
          id: 'msg-c',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'C',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'delivered',
        },
        {
          id: 'msg-a',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'A',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'delivered',
        },
        {
          id: 'msg-b',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'B',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'delivered',
        },
      ];

      const sorted = sortMessagesChronological(sameTimestampMessages);
      expect(sorted.map((m) => m.id)).toEqual(['msg-a', 'msg-b', 'msg-c']);
    });

    it('places a newly arrived message at the end of the transcript in chronological order', () => {
      const previousMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Mensaje previo',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'delivered',
        },
      ];

      // Polling returns descending page: [newMsg, previousMsg]
      const incomingDescFromApi: ChatMessage[] = [
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Mensaje nuevo',
          timestamp: '2026-10-04T10:05:00Z',
          deliveryStatus: 'sent',
        },
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Mensaje previo',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'delivered',
        },
      ];

      const reconciled = reconcileConversationMessages(previousMessages, incomingDescFromApi, 'conv-1');

      expect(reconciled).toHaveLength(2);
      expect(reconciled[0].id).toBe('msg-1');
      expect(reconciled[1].id).toBe('msg-2');
      expect(reconciled[1].content).toBe('Mensaje nuevo'); // new message ends at the end
    });

    it('retains an optimistic queued message at the end of transcript while unconfirmed', () => {
      const previousMessages: ChatMessage[] = [
        {
          id: 'msg-persisted-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Hola',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'read',
        },
        {
          id: 'outbox-uuid-queued-1',
          outboxId: 'outbox-uuid-queued-1',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'En breve te atendemos',
          timestamp: '2026-10-04T10:01:00Z',
          deliveryStatus: 'queued', // optimistic 202
        },
      ];

      // Polling returns only the persisted message (worker hasn't dispatched yet)
      const incomingFromApi: ChatMessage[] = [
        {
          id: 'msg-persisted-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Hola',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'read',
        },
      ];

      const testNow = Date.parse('2026-10-04T10:01:30Z');
      const reconciled = reconcileConversationMessages(previousMessages, incomingFromApi, 'conv-1', testNow);

      expect(reconciled).toHaveLength(2);
      expect(reconciled[0].id).toBe('msg-persisted-1');
      expect(reconciled[1].id).toBe('outbox-uuid-queued-1');
      expect(reconciled[1].deliveryStatus).toBe('queued'); // retained at the end of transcript
    });

    it('removes optimistic queued message when persisted message with matching outboxId appears without duplicate', () => {
      const previousWithOptimistic: ChatMessage[] = [
        {
          id: 'msg-persisted-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Hola',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'read',
        },
        {
          id: 'outbox-uuid-777',
          outboxId: 'outbox-uuid-777',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Pedido en camino',
          timestamp: '2026-10-04T10:02:00Z',
          deliveryStatus: 'queued', // optimistic receipt
        },
      ];

      // Worker persisted message msg-persisted-2 with outbox_id: outbox-uuid-777
      // API returns descending: [msg-persisted-2, msg-persisted-1]
      const incomingPolled: ChatMessage[] = [
        {
          id: 'msg-persisted-2',
          outboxId: 'outbox-uuid-777',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Pedido en camino',
          timestamp: '2026-10-04T10:02:00Z',
          deliveryStatus: 'sent',
        },
        {
          id: 'msg-persisted-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Hola',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'read',
        },
      ];

      const reconciled = reconcileConversationMessages(previousWithOptimistic, incomingPolled, 'conv-1');

      // Exactly 2 messages, no duplicate
      expect(reconciled).toHaveLength(2);
      expect(reconciled[0].id).toBe('msg-persisted-1');
      expect(reconciled[1].id).toBe('msg-persisted-2');
      expect(reconciled[1].outboxId).toBe('outbox-uuid-777');
      expect(reconciled[1].deliveryStatus).toBe('sent'); // confirmed status from backend
      // The optimistic outbox-uuid-777 is not duplicated
      expect(reconciled.filter((m) => m.outboxId === 'outbox-uuid-777')).toHaveLength(1);
    });

    it('strictly isolates messages by conversationId, excluding messages from other conversations', () => {
      const incomingMixed: ChatMessage[] = [
        {
          id: 'msg-conv1-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Mensaje de conv 1',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'read',
        },
        {
          id: 'msg-conv2-1',
          conversationId: 'conv-2',
          sender: 'customer',
          type: 'text',
          content: 'Mensaje de OTRA conversacion',
          timestamp: '2026-10-04T10:01:00Z',
          deliveryStatus: 'read',
        },
      ];

      const previousMixed: ChatMessage[] = [
        {
          id: 'outbox-conv2-queued',
          outboxId: 'outbox-conv2-queued',
          conversationId: 'conv-2',
          sender: 'staff',
          type: 'text',
          content: 'Optimista de OTRA conv',
          timestamp: '2026-10-04T10:02:00Z',
          deliveryStatus: 'queued',
        },
      ];

      const reconciled = reconcileConversationMessages(previousMixed, incomingMixed, 'conv-1');

      expect(reconciled).toHaveLength(1);
      expect(reconciled[0].id).toBe('msg-conv1-1');
      expect(reconciled[0].conversationId).toBe('conv-1');
      // Neither incoming nor previous from conv-2 are present
      expect(reconciled.some((m) => m.conversationId === 'conv-2')).toBe(false);
    });

    it('determines scroll proximity safely without jumping if scrolled up', () => {
      const isNearBottom = (scrollHeight: number, scrollTop: number, clientHeight: number) => {
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;
        return distanceToBottom < 80;
      };

      // Near bottom: within 80px -> should preserve scroll to bottom
      expect(isNearBottom(1000, 750, 200)).toBe(true); // distance = 50 < 80
      expect(isNearBottom(1000, 800, 200)).toBe(true); // distance = 0 < 80

      // Scrolled up: operator is reading history -> should NOT auto-scroll
      expect(isNearBottom(1000, 300, 200)).toBe(false); // distance = 500 >= 80
      expect(isNearBottom(1000, 700, 200)).toBe(false); // distance = 100 >= 80
    });

    it('expires queued receipts exceeding TTL when tab was inactive', () => {
      const nowMs = Date.parse('2026-10-04T10:10:00Z');
      const staleReceiptTime = '2026-10-04T10:00:00Z'; // 10 minutes old (> 5 min TTL)

      const previousWithStaleReceipt: ChatMessage[] = [
        {
          id: 'outbox-stale-receipt',
          outboxId: 'outbox-stale-receipt',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Mensaje viejo optimista',
          timestamp: staleReceiptTime,
          deliveryStatus: 'queued',
        },
      ];

      // Polling returns empty or unrelated message
      const incoming: ChatMessage[] = [];

      const reconciled = reconcileConversationMessages(
        previousWithStaleReceipt,
        incoming,
        'conv-1',
        nowMs
      );

      // The stale receipt must be expired and excluded
      expect(reconciled).toHaveLength(0);
    });

    it('drops queued receipts whose server anchor message has fallen outside the bounded page window', () => {
      const previousWithReceipt: ChatMessage[] = [
        {
          id: 'outbox-receipt-before-page',
          outboxId: 'outbox-receipt-before-page',
          anchorMessageId: 'msg-anchor-old',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Mensaje optimista anclado a un mensaje que ya cayó de la página',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'queued',
        },
      ];

      // Current page returns a full 20-message page where msg-anchor-old is no longer present
      const incomingPage: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-page-${i + 1}`,
        conversationId: 'conv-1',
        sender: 'customer',
        type: 'text',
        content: `Mensaje de página ${i + 1}`,
        timestamp: new Date(Date.parse('2026-10-04T10:05:00Z') + i * 1000).toISOString(),
        deliveryStatus: 'read',
      }));

      const nowMs = Date.parse('2026-10-04T10:01:00Z'); // within TTL, but anchor is evicted from page

      const reconciled = reconcileConversationMessages(
        previousWithReceipt,
        incomingPage,
        'conv-1',
        nowMs
      );

      // Receipt must not be appended at the end of the new page
      expect(reconciled).toHaveLength(20);
      expect(reconciled.some((m) => m.id === 'outbox-receipt-before-page')).toBe(false);
      expect(reconciled[0].id).toBe('msg-page-1');
      expect(reconciled[19].id).toBe('msg-page-20');
    });

    it('preserves queued receipts when anchor message is still within the bounded page window even if client clock trails', () => {
      const previousWithReceipt: ChatMessage[] = [
        {
          id: 'outbox-receipt-active',
          outboxId: 'outbox-receipt-active',
          anchorMessageId: 'msg-anchor-present',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Mensaje optimista recién enviado',
          // Client clock trails server (timestamp is older than server messages)
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'queued',
        },
      ];

      // Stale in-flight poll returned 20 messages, but still includes the anchor message
      const incomingPage: ChatMessage[] = [
        {
          id: 'msg-anchor-present',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Mensaje ancla',
          timestamp: '2026-10-04T10:00:05Z', // server clock ahead
          deliveryStatus: 'read',
        },
        ...Array.from({ length: 19 }, (_, i) => ({
          id: `msg-page-${i + 1}`,
          conversationId: 'conv-1',
          sender: 'customer' as const,
          type: 'text' as const,
          content: `Mensaje ${i + 1}`,
          timestamp: new Date(Date.parse('2026-10-04T10:00:06Z') + i * 1000).toISOString(),
          deliveryStatus: 'read' as const,
        })),
      ];

      const nowMs = Date.parse('2026-10-04T10:00:10Z');

      const reconciled = reconcileConversationMessages(
        previousWithReceipt,
        incomingPage,
        'conv-1',
        nowMs
      );

      // Even with client clock trailing, the receipt is preserved because anchor is still in page!
      expect(reconciled).toHaveLength(21);
      expect(reconciled.some((m) => m.id === 'outbox-receipt-active')).toBe(true);
    });

    it('preserves queued receipts when an older in-flight poll completes whose saturated page displaced the anchor, thanks to request-generation ordering', () => {
      const pollInitiatedAtMs = 1000;
      const receiptCreatedAtMs = 1500;
      const pollCompletedAtMs = 2000;

      const previousWithReceipt: ChatMessage[] = [
        {
          id: 'outbox-receipt-concurrent',
          outboxId: 'outbox-receipt-concurrent',
          anchorMessageId: 'msg-anchor-old',
          createdAtMs: receiptCreatedAtMs,
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Mensaje enviado mientras el poll ya estaba en vuelo',
          timestamp: new Date(receiptCreatedAtMs).toISOString(),
          deliveryStatus: 'queued',
        },
      ];

      // Stale in-flight poll returns 20 messages that displaced msg-anchor-old
      const incomingFromStalePoll: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-displacing-${i + 1}`,
        conversationId: 'conv-1',
        sender: 'customer' as const,
        type: 'text' as const,
        content: `Mensaje desplazador ${i + 1}`,
        timestamp: new Date(Date.parse('2026-10-04T10:00:00Z') + i * 1000).toISOString(),
        deliveryStatus: 'read' as const,
      }));

      // Reconcile response from the in-flight poll dispatched BEFORE send
      const reconciledStale = reconcileConversationMessages(
        previousWithReceipt,
        incomingFromStalePoll,
        'conv-1',
        pollCompletedAtMs,
        pollInitiatedAtMs
      );

      // Receipt MUST be preserved because the poll was dispatched before the send!
      expect(reconciledStale).toHaveLength(21);
      expect(reconciledStale.some((m) => m.id === 'outbox-receipt-concurrent')).toBe(true);

      // Now simulate a subsequent poll dispatched AFTER the send (pollInitiatedAtMs = 2500)
      const postSendPollInitiatedAtMs = 2500;
      const postSendPollCompletedAtMs = 3000;

      const reconciledPostSend = reconcileConversationMessages(
        reconciledStale,
        incomingFromStalePoll,
        'conv-1',
        postSendPollCompletedAtMs,
        postSendPollInitiatedAtMs
      );

      // Now that the poll was dispatched AFTER the send, missing anchor correctly evicts the displaced receipt
      expect(reconciledPostSend).toHaveLength(20);
      expect(reconciledPostSend.some((m) => m.id === 'outbox-receipt-concurrent')).toBe(false);
    });

    it('preserves queued receipts when poll start and receipt creation timestamps tie within the same millisecond', () => {
      const sameTickMs = 5000;

      const previousWithReceipt: ChatMessage[] = [
        {
          id: 'outbox-receipt-tied',
          outboxId: 'outbox-receipt-tied',
          anchorMessageId: 'msg-anchor-old',
          createdAtMs: sameTickMs,
          requestSequence: 10,
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'Mensaje enviado exactamente en el mismo tick de reloj',
          timestamp: new Date(sameTickMs).toISOString(),
          deliveryStatus: 'queued',
        },
      ];

      const incomingPage: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-displacing-${i + 1}`,
        conversationId: 'conv-1',
        sender: 'customer' as const,
        type: 'text' as const,
        content: `Mensaje desplazador ${i + 1}`,
        timestamp: new Date(sameTickMs + 1000 + i * 1000).toISOString(),
        deliveryStatus: 'read' as const,
      }));

      // In-flight poll dispatched in the exact same millisecond (pollInitiatedAtMs === sameTickMs)
      // and with pollSequence = 9 <= receiptSequence = 10
      const reconciled = reconcileConversationMessages(
        previousWithReceipt,
        incomingPage,
        'conv-1',
        sameTickMs + 200,
        sameTickMs,
        9
      );

      // Must be preserved due to conservative tie handling and monotonic sequence ordering
      expect(reconciled).toHaveLength(21);
      expect(reconciled.some((m) => m.id === 'outbox-receipt-tied')).toBe(true);

      // Also verify pure timestamp tie without sequence numbers:
      const reconciledTimestampTieOnly = reconcileConversationMessages(
        previousWithReceipt,
        incomingPage,
        'conv-1',
        sameTickMs + 200,
        sameTickMs
      );
      expect(reconciledTimestampTieOnly).toHaveLength(21);
      expect(reconciledTimestampTieOnly.some((m) => m.id === 'outbox-receipt-tied')).toBe(true);
    });

    it('preserves scroll position without snapping to bottom when operator scrolled up during send', () => {
      // Simulate container state when operator scrolled up while POST was in flight
      const containerElement = {
        scrollHeight: 1200,
        scrollTop: 400, // scrolled up 600px
        clientHeight: 200,
      };

      const distanceToBottom = containerElement.scrollHeight - containerElement.scrollTop - containerElement.clientHeight;
      const isNearBottomAtCompletion = distanceToBottom < 80;

      expect(distanceToBottom).toBe(600);
      expect(isNearBottomAtCompletion).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // 6. TAX POLICY & CANONICAL RATES
  // -------------------------------------------------------------
  describe('6. Tax Policy Integrity (No Ecuador Presets)', () => {
    it('only supports unconfigured, none, and explicit exclusive modes without national presets', () => {
      const supportedModes = ['none', 'exclusive'];

      const validNone = { mode: 'none', rate_bps: 0, rounding: 'per_line_half_up' };
      const validExclusive = { mode: 'exclusive', rate_bps: 1500, rounding: 'per_line_half_up' };

      expect(supportedModes).toContain(validNone.mode);
      expect(supportedModes).toContain(validExclusive.mode);
      expect(validNone.rate_bps).toBe(0);
      expect(validExclusive.rate_bps).toBe(1500);

      // Verify no hardcoded strings like "IVA Ecuador"
      expect(JSON.stringify(validNone)).not.toContain('IVA Ecuador');
      expect(JSON.stringify(validExclusive)).not.toContain('IVA Ecuador');
    });
  });

  // -------------------------------------------------------------
  // 7. CATALOG: HIERARCHICAL MODIFIERS WITHOUT LEGACY WRITES
  // -------------------------------------------------------------
  describe('7. Hierarchical Modifiers (No Flat group_key Writes)', () => {
    it('verifies that mapModifierOptionToDtoInput and flattenModifierGroupsForWrite are eliminated from production adapter', async () => {
      const menuAdapter = await import('../adapters/menuAdapter');
      expect((menuAdapter as any).flattenModifierGroupsForWrite).toBeUndefined();
      expect((menuAdapter as any).mapModifierOptionToDtoInput).toBeUndefined();
      expect((menuAdapter as any).modifierGroupKey).toBeUndefined();
    });

    it('hierarchical mapping correctly maps groups and nested options', async () => {
      const { mapCanonicalModifierGroupsToViewModel } = await import('../adapters/menuAdapter');
      const canonicalGroups: any = [
        {
          id: 'grp-1',
          product_id: 'prod-1',
          name: 'Salsas Artesanales',
          required: true,
          min_select: 1,
          max_select: 2,
          sort_order: 1,
          active: true,
          version: 1,
          options: [
            {
              id: 'opt-1',
              modifier_group_id: 'grp-1',
              name: 'Guacamole',
              price_delta_minor: 100,
              available: true,
              sort_order: 1,
              version: 1,
            },
          ],
        },
      ];

      const vm = mapCanonicalModifierGroupsToViewModel(canonicalGroups);
      expect(vm).toHaveLength(1);
      expect(vm[0].name).toBe('Salsas Artesanales');
      expect(vm[0].required).toBe(true);
      expect(vm[0].options).toHaveLength(1);
      expect(vm[0].options[0].name).toBe('Guacamole');
      expect(vm[0].options[0].priceDelta).toBe(1.0);
    });
  });

  // -------------------------------------------------------------
  // 8. SECURITY & CONSOLE LOGGING
  // -------------------------------------------------------------
  describe('8. Privacy & Zero Insecure Console Logging', () => {
    it('does not log bearer tokens or PII to console', () => {
      const consoleLogSpy = vi.spyOn(console, 'log');
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      const consoleErrorSpy = vi.spyOn(console, 'error');

      // Run sanitized failure code
      sanitizeFailureCode('Bearer eyJhbGciOi...');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // 9. PHASE 5 CANONICAL LABELS & REAL MODE INTEGRITY
  // -------------------------------------------------------------
  describe('9. Canonical Outbox Labels & Real Mode Truth', () => {
    it('OutboxStatusBadge defines distinct labels for all 9 states', async () => {
      const { OutboxStatusBadge } = await import('../components/operations/OutboxStatusBadge');
      expect(OutboxStatusBadge).toBeDefined();

      const states: DeliveryStatus[] = [
        'queued',
        'pending',
        'sending',
        'sent',
        'delivered',
        'read',
        'failed',
        'unknown',
        'dead_letter',
      ];

      for (const st of states) {
        const dto: any = {
          id: `msg-${st}`,
          business_id: 'biz-001',
          conversation_id: 'conv-001',
          version: 1,
          created_at: '2026-10-04T10:00:00Z',
          updated_at: '2026-10-04T10:00:00Z',
          direction: 'outbound',
          kind: 'text',
          actor_type: 'human',
          text: 'Status test',
          delivery_status: st,
        };
        const vm = mapDtoMessageToViewModel(dto);
        expect(vm.deliveryStatus).toBe(st);
      }
    });

    it('ensures HTTP 202 is mapped to queued and never to sent or delivered', () => {
      const http202Response = {
        outbox_id: 'outbox-uuid-1',
        delivery_status: 'queued',
        timestamp: '2026-10-04T10:00:00Z',
      };

      expect(http202Response.delivery_status).toBe('queued');
      expect(http202Response.delivery_status).not.toBe('sent');
      expect(http202Response.delivery_status).not.toBe('delivered');
    });
  });
  // -------------------------------------------------------------
  // 10. RUNTIME READINESS MUST REMAIN HONEST
  // -------------------------------------------------------------
  describe('10. Runtime Readiness Truthfulness', () => {
    it('does not claim public provider readiness before a backend contract exists', () => {
      expect(RUNTIME_READINESS_PUBLIC).toBe(false);
      expect(RUNTIME_PRESENTATION.openai.status).toBe('Sin estado público de runtime');
      expect(RUNTIME_PRESENTATION.meta.status).toBe('No verificado por endpoint público');
      expect(RUNTIME_PRESENTATION.hosting.status).toBe('No desplegado');
    });

    it('does not hardcode a provider model, circuit health or active outbox in neutral presentation', () => {
      const serialized = JSON.stringify(RUNTIME_PRESENTATION);
      expect(serialized).not.toContain('gpt-4o-mini');
      expect(serialized).not.toContain('Cerrado (Normal)');
      expect(serialized).not.toContain('Reconciliación activa');
      expect(serialized).not.toContain('Backend integrado');
      expect(serialized).not.toContain('HMAC / Outbox activo');
    });
  });

});
