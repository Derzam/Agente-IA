import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../api/client';
import {
  NormalizedApiError,
  VersionConflictError,
  TimeoutError,
} from '../api/types';

describe('ApiClient Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('attaches Authorization Bearer header when token is available', async () => {
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init.headers;
      return new Response(JSON.stringify({ data: { status: 'ok' }, meta: { request_id: 'req-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new ApiClient({
      baseUrl: 'http://api.test/v1',
      getAccessToken: () => 'my-jwt-token-123',
    });

    const result = await client.request('/test');
    expect(result).toEqual({ status: 'ok' });
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer my-jwt-token-123');
  });

  it('correctly scopes business requests to /v1/businesses/{business_id}/...', async () => {
    let capturedUrl: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new ApiClient({
      baseUrl: 'http://api.test/v1',
      getActiveBusinessId: () => 'biz-uuid-999',
    });

    await client.businessRequest('/orders');
    expect(capturedUrl).toBe('http://api.test/v1/businesses/biz-uuid-999/orders');
  });

  it('generates and propagates request_id header', async () => {
    let capturedRequestId: string | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedRequestId = init.headers.get('x-request-id');
      return new Response(JSON.stringify({ data: true }), { status: 200 });
    });

    const client = new ApiClient({ baseUrl: 'http://api.test/v1' });
    await client.request('/ping');
    expect(capturedRequestId).toBeTruthy();
    expect(typeof capturedRequestId).toBe('string');
  });

  it('throws TimeoutError when request exceeds timeoutMs', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(init.signal.reason);
        });
      });
    });

    const client = new ApiClient({ baseUrl: 'http://api.test/v1', defaultTimeoutMs: 50 });

    await expect(client.request('/slow')).rejects.toThrow(TimeoutError);
  });

  it('handles 409 VERSION_CONFLICT by throwing VersionConflictError with canonical message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VERSION_CONFLICT',
            message: 'El pedido cambió; actualiza antes de repetir la acción.',
            details: [],
            retryable: false,
          },
          meta: { request_id: 'req-409' },
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

    try {
      await client.request('/orders/123/transitions', { method: 'POST' });
      expect.fail('Should have thrown VersionConflictError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersionConflictError);
      expect(err.code).toBe('VERSION_CONFLICT');
      expect(err.message).toBe(
        'Este registro cambió. Revisa la nueva información antes de volver a ejecutar la acción.'
      );
      expect(err.requestId).toBe('req-409');
    }
  });

  it('handles 422 VALIDATION_ERROR by preserving field validation details', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Campo requerido no proporcionado.',
            details: [{ field: 'reason', issue: 'required' }],
            retryable: false,
          },
          meta: { request_id: 'req-422' },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

    try {
      await client.request('/categories', { method: 'POST' });
      expect.fail('Should have thrown NormalizedApiError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(NormalizedApiError);
      expect(err.status).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual([{ field: 'reason', issue: 'required' }]);
    }
  });

  it('handles 429 RATE_LIMITED by parsing Retry-After header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Demasiadas solicitudes.',
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
      )
    );

    const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

    try {
      await client.request('/metrics');
      expect.fail('Should have thrown NormalizedApiError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(NormalizedApiError);
      expect(err.status).toBe(429);
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.retryAfterSeconds).toBe(45);
      expect(err.message).toContain('45 segundos');
    }
  });

  it('handles 503 PROVIDER_UNAVAILABLE', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Servicio upstream de Meta no disponible temporalmente.',
            retryable: true,
          },
          meta: { request_id: 'req-503' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = new ApiClient({ baseUrl: 'http://api.test/v1' });

    await expect(client.request('/conversations/1/messages', { method: 'POST' })).rejects.toThrow(
      NormalizedApiError
    );
  });
});
