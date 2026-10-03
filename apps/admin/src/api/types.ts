import type {
  ErrorCode,
  Meta,
  ApiResponse,
  Page,
  ApiError as CanonicalApiError,
  UUID,
} from '@agente-ia/shared';

export type { ErrorCode, Meta, ApiResponse, Page, CanonicalApiError, UUID };

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
  idempotencyKey?: string;
  businessId?: string;
  expectedVersion?: number;
}

export class NormalizedApiError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details: { field: string; issue: string }[];
  public readonly retryable: boolean;
  public readonly requestId?: string;
  public readonly retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    code: ErrorCode;
    status: number;
    details?: { field: string; issue: string }[];
    retryable?: boolean;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details || [];
    this.retryable = params.retryable ?? false;
    this.requestId = params.requestId;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

export class VersionConflictError extends NormalizedApiError {
  constructor(message?: string, requestId?: string) {
    super({
      message:
        message ||
        'Este registro cambió. Revisa la nueva información antes de volver a ejecutar la acción.',
      code: 'VERSION_CONFLICT',
      status: 409,
      retryable: false,
      requestId,
    });
    this.name = 'VersionConflictError';
  }
}

export class NetworkError extends Error {
  public readonly originalError?: unknown;

  constructor(message = 'Error de conexión a la red. Comprueba tu conexión a internet.', originalError?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.originalError = originalError;
  }
}

export class TimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`La solicitud excedió el tiempo límite de ${timeoutMs}ms.`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class AuthError extends Error {
  public readonly status: number;

  constructor(message = 'Sesión inválida o expirada.', status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
