import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Security verification: Never allow service role key or db connection strings in client bundle
const isForbiddenKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return lower.includes('service_role') || lower.includes('service-role') || lower.startsWith('postgres://');
};

if (isForbiddenKey(supabasePublishableKey)) {
  throw new Error('SECURITY VIOLATION: Service role key or DB credentials cannot be exposed to the frontend bundle.');
}

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (clientInstance) {
    return clientInstance;
  }

  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  clientInstance = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'agente_ia_admin_auth',
    },
  });

  return clientInstance;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabasePublishableKey);
}
