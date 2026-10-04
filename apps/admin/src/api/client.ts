import {
  NormalizedApiError,
  VersionConflictError,
  NetworkError,
  TimeoutError,
  AuthError,
  RequestOptions,
  ErrorCode,
  VERSION_CONFLICT_MESSAGE,
} from './types';

export interface ApiClientConfig {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  getAccessToken?: () => Promise<string | null> | string | null;
  refreshAccessToken?: () => Promise<string | null>;
  onAuthExpired?: () => void;
  getActiveBusinessId?: () => string | null;
}

export class ApiClient {
  private baseUrl: string;
  private defaultTimeoutMs: number;
  private getAccessToken?: () => Promise<string | null> | string | null;
  private refreshAccessToken?: () => Promise<string | null>;
  private onAuthExpired?: () => void;
  private getActiveBusinessId?: () => string | null;
  private isRefreshing = false;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = (config.baseUrl || import.meta.env.VITE_API_URL || '/v1').replace(/\/+$/, '');
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 15000;
    this.getAccessToken = config.getAccessToken;
    this.refreshAccessToken = config.refreshAccessToken;
    this.onAuthExpired = config.onAuthExpired;
    this.getActiveBusinessId = config.getActiveBusinessId;
  }

  public setConfig(config: Partial<ApiClientConfig>) {
    if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (config.defaultTimeoutMs !== undefined) this.defaultTimeoutMs = config.defaultTimeoutMs;
    if (config.getAccessToken !== undefined) this.getAccessToken = config.getAccessToken;
    if (config.refreshAccessToken !== undefined) this.refreshAccessToken = config.refreshAccessToken;
    if (config.onAuthExpired !== undefined) this.onAuthExpired = config.onAuthExpired;
    if (config.getActiveBusinessId !== undefined) this.getActiveBusinessId = config.getActiveBusinessId;
  }

  public async request<T>(endpoint: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Connect external signal if provided
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
      }
    }

    timeoutId = setTimeout(() => {
      controller.abort(new TimeoutError(timeoutMs));
    }, timeoutMs);

    const headers = new Headers(options.headers || {});

    // Ensure JSON Content-Type when sending body
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    // Ensure Request-ID
    const clientRequestId = headers.get('x-request-id') || crypto.randomUUID();
    headers.set('x-request-id', clientRequestId);

    // Ensure Idempotency-Key if provided in options
    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    // Add Authorization Bearer
    if (!options.skipAuth && this.getAccessToken) {
      const token = await this.getAccessToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const fullUrl = `${this.baseUrl}${cleanEndpoint}`;

    try {
      const response = await fetch(fullUrl, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized with single refresh attempt
      if (response.status === 401) {
        if (!isRetry && this.refreshAccessToken) {
          try {
            const newToken = await this.performRefresh();
            if (newToken) {
              return this.request<T>(endpoint, options, true);
            }
          } catch {
            // refresh failed
          }
        }
        this.onAuthExpired?.();
        throw new AuthError('Sesión no autorizada o expirada.', 401);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as unknown as T;
      }

      // Parse JSON response
      let responseBody: any = null;
      const text = await response.text();
      if (text) {
        try {
          responseBody = JSON.parse(text);
        } catch {
          responseBody = { message: text };
        }
      }

      if (!response.ok) {
        this.handleErrorResponse(response.status, response.headers, responseBody, clientRequestId);
      }

      // Return unwrapped canonical data if envelope present, otherwise body directly
      if (responseBody && typeof responseBody === 'object' && 'data' in responseBody) {
        return responseBody.data as T;
      }

      return responseBody as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof NormalizedApiError || err instanceof AuthError || err instanceof TimeoutError) {
        throw err;
      }

      if (controller.signal.aborted) {
        if (controller.signal.reason instanceof TimeoutError) {
          throw controller.signal.reason;
        }
        // General abort (cancellation by caller)
        throw err;
      }

      // Network error (fetch failed, offline, DNS error, CORS error)
      throw new NetworkError('Error de conexión con el servidor. Revisa tu conexión a internet.', err);
    }
  }

  public async businessRequest<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const businessId = options.businessId || this.getActiveBusinessId?.();
    if (!businessId) {
      throw new NormalizedApiError({
        code: 'VALIDATION_ERROR',
        message: 'No se ha seleccionado ningún negocio activo.',
        status: 400,
      });
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return this.request<T>(`/businesses/${businessId}${cleanEndpoint}`, options);
  }

  private async performRefresh(): Promise<string | null> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }
    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        if (!this.refreshAccessToken) return null;
        return await this.refreshAccessToken();
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private handleErrorResponse(
    status: number,
    headers: Headers,
    body: any,
    fallbackRequestId: string
  ): never {
    const errorPayload = body?.error;
    const metaPayload = body?.meta;
    const requestId = metaPayload?.request_id || headers.get('x-request-id') || fallbackRequestId;

    let code: ErrorCode = (errorPayload?.code as ErrorCode) || 'INTERNAL_ERROR';
    let message = errorPayload?.message || 'Error en la solicitud.';
    const details = errorPayload?.details || [];
    const retryable = Boolean(errorPayload?.retryable);

    // 409 Conflict / Version Conflict
    if (status === 409) {
      if (code === 'VERSION_CONFLICT' || message.toLowerCase().includes('versión') || message.toLowerCase().includes('version')) {
        throw new VersionConflictError(VERSION_CONFLICT_MESSAGE, requestId);
      }
    }

    // 429 Rate Limited
    let retryAfterSeconds: number | undefined;
    if (status === 429) {
      code = 'RATE_LIMITED';
      const retryHeader = headers.get('Retry-After');
      if (retryHeader) {
        const parsed = parseInt(retryHeader, 10);
        if (!isNaN(parsed)) {
          retryAfterSeconds = parsed;
        }
      }
      message = retryAfterSeconds
        ? `Límite de solicitudes alcanzado. Por favor espera ${retryAfterSeconds} segundos.`
        : 'Límite de solicitudes alcanzado. Por favor intenta más tarde.';
    }

    // 403 Forbidden
    if (status === 403) {
      code = 'FORBIDDEN';
      message = message || 'No tienes permisos suficientes para realizar esta acción.';
    }

    // 404 Not Found
    if (status === 404) {
      code = 'NOT_FOUND';
      message = message || 'El recurso solicitado no existe o no está disponible.';
    }

    // 422 Validation Error
    if (status === 422) {
      code = 'VALIDATION_ERROR';
    }

    // 503 Provider Unavailable
    if (status === 503) {
      code = 'PROVIDER_UNAVAILABLE';
      message = message || 'El servicio o dependencia no está disponible temporalmente.';
    }

    throw new NormalizedApiError({
      code,
      message,
      status,
      details,
      retryable,
      requestId,
      retryAfterSeconds,
    });
  }
}

export const defaultApiClient = new ApiClient();
