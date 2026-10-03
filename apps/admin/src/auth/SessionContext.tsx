import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import { defaultApiClient } from '@/api/client';

export const USE_MOCK_DATA =
  import.meta.env.VITE_USE_MOCK_DATA !== undefined
    ? import.meta.env.VITE_USE_MOCK_DATA === 'true'
    : true;

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, any>;
}

export interface SessionContextType {
  user: AuthUser | null;
  session: Session | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isSessionExpired: boolean;
  isMockMode: boolean;
  signIn: (credentials: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  clearExpiredNotice: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

const MOCK_USER: AuthUser = {
  id: 'usr-mock-owner-001',
  email: 'admin@demo-burgers.test',
  user_metadata: { name: 'Admin General', role: 'owner' },
};

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(USE_MOCK_DATA ? MOCK_USER : null);
  const [session, setSession] = useState<Session | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(USE_MOCK_DATA ? 'mock-access-token-001' : null);
  const [isLoading, setIsLoading] = useState(!USE_MOCK_DATA);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  const supabase = useMemo(() => getSupabaseClient(), []);

  // Hook for 401 callback in ApiClient
  const handleAuthExpired = useCallback(() => {
    setIsSessionExpired(true);
    setUser(null);
    setSession(null);
    setAccessToken(null);
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    if (USE_MOCK_DATA) {
      return 'mock-access-token-001';
    }

    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        handleAuthExpired();
        return null;
      }
      setSession(data.session);
      setUser(data.session.user);
      setAccessToken(data.session.access_token);
      return data.session.access_token;
    } catch {
      handleAuthExpired();
      return null;
    }
  }, [supabase, handleAuthExpired]);

  // Connect API client callbacks
  useEffect(() => {
    defaultApiClient.setConfig({
      getAccessToken: () => accessToken,
      refreshAccessToken: refreshSession,
      onAuthExpired: handleAuthExpired,
    });
  }, [accessToken, refreshSession, handleAuthExpired]);

  // Initial session restoration from Supabase
  useEffect(() => {
    if (USE_MOCK_DATA) {
      setIsLoading(false);
      return;
    }

    if (!supabase) {
      // Real mode requested but Supabase not configured
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function initSession() {
      try {
        const { data, error } = await supabase!.auth.getSession();
        if (error) {
          throw error;
        }

        if (isMounted) {
          if (data.session) {
            setSession(data.session);
            setUser(data.session.user);
            setAccessToken(data.session.access_token);
            setIsSessionExpired(false);
          } else {
            setSession(null);
            setUser(null);
            setAccessToken(null);
          }
        }
      } catch (err) {
        if (isMounted) {
          setUser(null);
          setSession(null);
          setAccessToken(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initSession();

    // Listen to Supabase auth state events
    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!isMounted) return;

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (newSession) {
          setSession(newSession);
          setUser(newSession.user);
          setAccessToken(newSession.access_token);
          setIsSessionExpired(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setAccessToken(null);
      }
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      if (USE_MOCK_DATA) {
        setUser(MOCK_USER);
        setAccessToken('mock-access-token-001');
        setIsSessionExpired(false);
        return;
      }

      if (!supabase) {
        throw new Error('Supabase no está configurado. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.');
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }

      if (data.session) {
        setSession(data.session);
        setUser(data.user);
        setAccessToken(data.session.access_token);
        setIsSessionExpired(false);
      }
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (USE_MOCK_DATA) {
      setUser(null);
      setSession(null);
      setAccessToken(null);
      return;
    }

    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setAccessToken(null);
  }, [supabase]);

  const clearExpiredNotice = useCallback(() => {
    setIsSessionExpired(false);
  }, []);

  const value: SessionContextType = {
    user,
    session,
    accessToken,
    isAuthenticated: Boolean(user && accessToken),
    isLoading,
    isSessionExpired,
    isMockMode: USE_MOCK_DATA,
    signIn,
    signOut,
    refreshSession,
    clearExpiredNotice,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionContextType {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
