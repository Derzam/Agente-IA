import type { ApiError, ErrorCode } from '@agente-ia/shared';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: ErrorCode, message: string, public readonly retryable = false) {
    super(message);
  }
}
export const unavailable = () => new AppError(503, 'PROVIDER_UNAVAILABLE', 'Dependencia temporalmente no disponible.', true);
export const validation = () => new AppError(400, 'VALIDATION_ERROR', 'Solicitud inválida.');
export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Se requiere una sesión válida.');
export function errorEnvelope(error: AppError, requestId: string): ApiError {
  return { error: { code: error.code, message: error.message, details: [], retryable: error.retryable }, meta: { request_id: requestId } };
}
