/**
 * Unified API Client Interface
 * Integrates real ApiClient with mock mode and idempotency helpers.
 */

import { defaultApiClient, ApiClient } from '@/api/client';
import { RequestOptions, NetworkError } from '@/api/types';

export const USE_MOCK_DATA =
  import.meta.env.VITE_USE_MOCK_DATA !== undefined
    ? import.meta.env.VITE_USE_MOCK_DATA === 'true'
    : true;

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/v1';
export const BUSINESS_ID = import.meta.env.VITE_BUSINESS_ID || '';

export async function request<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  return defaultApiClient.request<T>(endpoint, options);
}

export async function businessRequest<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  return defaultApiClient.businessRequest<T>(endpoint, options);
}

/**
 * Generates a fresh Idempotency-Key for a new user intention.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Reuses the same idempotencyKey during network retries of the SAME user gesture.
 * If a NetworkError occurs, the caller can retry with the identical key.
 */
export async function executeWithNetworkRetry<T>(
  action: (idempotencyKey: string) => Promise<T>,
  existingKey?: string
): Promise<T> {
  const key = existingKey || newIdempotencyKey();
  try {
    return await action(key);
  } catch (err) {
    if (err instanceof NetworkError) {
      // Caller retains 'key' to safely retry without generating a duplicate intention
      throw Object.assign(err, { retainedIdempotencyKey: key });
    }
    throw err;
  }
}

export { defaultApiClient, ApiClient };
