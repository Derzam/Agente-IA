/**
 * API Client Configuration
 * Decoupled from direct Supabase access, prepares for Codex REST API
 */

export const USE_MOCK_DATA = true;

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

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
