/**
 * API Client Configuration
 * Prototype remains mock-first. Real requests follow the canonical Codex v0.1 contract.
 */

export const USE_MOCK_DATA = true;

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/v1';
export const BUSINESS_ID = import.meta.env.VITE_BUSINESS_ID || '';

export async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Request failed with status ${res.status}`);
  }

  const json = await res.json();
  return json.data;
}

export async function businessRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  if (!BUSINESS_ID) {
    throw new Error('VITE_BUSINESS_ID is required when mock data is disabled.');
  }
  return request<T>(`/businesses/${BUSINESS_ID}${endpoint}`, options);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
