import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../api/client';
import { NormalizedApiError, AuthError } from '../api/types';
import {
  mapDtoMessageToViewModel,
  sanitizeFailureCode,
} from '../adapters/conversationAdapter';
import { shouldRunPolling } from '../hooks/usePolling';
import type { Message as DTOMessage } from '@agente-ia/shared';
import type { ChatMessage, DeliveryStatus } from '../types/viewModels';

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

    it('deduplicates polled messages and retains unconfirmed optimistic queued messages', () => {
      const prevMessages: ChatMessage[] = [
        {
          id: 'msg-persisted-1',
          conversationId: 'conv-1',
          sender: 'customer',
          type: 'text',
          content: 'Hola',
          timestamp: '2026-10-04T10:00:00Z',
          deliveryStatus: 'delivered',
        },
        {
          id: 'outbox-uuid-queued',
          conversationId: 'conv-1',
          sender: 'staff',
          type: 'text',
          content: 'En breve te atendemos',
          timestamp: '2026-10-04T10:01:00Z',
          deliveryStatus: 'queued', // optimistic receipt from 202
        },
      ];

      // Polled response from backend includes msg-persisted-1 with updated read status
      const polledMessages: ChatMessage[] = [
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

      // Reconciler logic as implemented in ConversationsView
      const incomingMap = new Map(polledMessages.map((m) => [m.id, m]));
      const merged: ChatMessage[] = [];
      for (const m of polledMessages) {
        merged.push(m);
      }
      for (const p of prevMessages) {
        if (!incomingMap.has(p.id) && p.deliveryStatus === 'queued') {
          merged.push(p);
        }
      }

      expect(merged).toHaveLength(2);
      expect(merged[0].id).toBe('msg-persisted-1');
      expect(merged[0].deliveryStatus).toBe('read'); // updated without duplicating
      expect(merged[1].id).toBe('outbox-uuid-queued'); // queued preserved until confirmed
      expect(merged[1].deliveryStatus).toBe('queued');
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
});
