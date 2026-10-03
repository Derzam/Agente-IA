import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Business, Membership, Role, UUID } from '@agente-ia/shared';
import { useSession } from './SessionContext';
import { endpoints } from '@/api/endpoints';
import { defaultApiClient } from '@/api/client';

const STORAGE_KEY = 'agente_ia_selected_business_id';

export interface BusinessContextType {
  activeBusinessId: UUID | null;
  activeBusiness: Business | null;
  activeRole: Role | null;
  memberships: Membership[];
  isLoading: boolean;
  error: string | null;
  selectBusiness: (businessId: UUID) => void;
  refreshBusinessData: () => Promise<void>;
}

const BusinessContext = createContext<BusinessContextType | null>(null);

const MOCK_BUSINESS_ID = 'biz-00000000-0000-4000-8000-000000000001';
const MOCK_BUSINESS: Business = {
  id: MOCK_BUSINESS_ID,
  business_id: MOCK_BUSINESS_ID,
  name: 'Burger & Co. Centro',
  slug: 'burger-co-centro',
  currency: 'USD',
  timezone: 'America/Guayaquil',
  status: 'active',
  created_at: '2026-01-01T12:00:00Z',
  updated_at: '2026-01-01T12:00:00Z',
  version: 1,
};

const MOCK_MEMBERSHIPS: Membership[] = [
  { business_id: MOCK_BUSINESS_ID, role: 'owner' },
];

export const BusinessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isMockMode } = useSession();
  const [activeBusinessId, setActiveBusinessId] = useState<UUID | null>(null);
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync client active business ID
  useEffect(() => {
    defaultApiClient.setConfig({
      getActiveBusinessId: () => activeBusinessId,
    });
  }, [activeBusinessId]);

  const loadBusinessDetails = useCallback(
    async (businessId: UUID) => {
      try {
        if (isMockMode) {
          setActiveBusiness(MOCK_BUSINESS);
          return;
        }
        const b = await endpoints.getBusiness(businessId);
        setActiveBusiness(b);
      } catch (err: any) {
        setError(err.message || 'No se pudo cargar la información del negocio seleccionado.');
      }
    },
    [isMockMode]
  );

  const selectBusiness = useCallback(
    (businessId: UUID) => {
      // Validate that the business is in the authorized memberships list!
      const membership = memberships.find((m) => m.business_id === businessId);
      if (!membership) {
        throw new Error('No estás autorizado para acceder a este negocio.');
      }

      setActiveBusinessId(businessId);
      try {
        localStorage.setItem(STORAGE_KEY, businessId);
      } catch {
        // Ignore localStorage errors
      }
      loadBusinessDetails(businessId);
    },
    [memberships, loadBusinessDetails]
  );

  const initBusinessFlow = useCallback(async () => {
    if (!isAuthenticated) {
      setActiveBusinessId(null);
      setActiveBusiness(null);
      setMemberships([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (isMockMode) {
        setMemberships(MOCK_MEMBERSHIPS);
        setActiveBusinessId(MOCK_BUSINESS_ID);
        setActiveBusiness(MOCK_BUSINESS);
        setIsLoading(false);
        return;
      }

      // Fetch /v1/me
      const me = await endpoints.getMe();
      const userMemberships = me.memberships || [];
      setMemberships(userMemberships);

      if (userMemberships.length === 0) {
        setError('No tienes negocios asignados o autorizados para tu usuario.');
        setActiveBusinessId(null);
        setActiveBusiness(null);
        return;
      }

      // Check stored preference and revalidate against memberships
      let candidateId: UUID | null = null;
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && userMemberships.some((m) => m.business_id === stored)) {
          candidateId = stored;
        }
      } catch {
        // Ignore
      }

      // Default to first membership if no valid stored preference
      if (!candidateId) {
        candidateId = userMemberships[0].business_id;
      }

      const activeM = userMemberships.find((m) => m.business_id === candidateId) || userMemberships[0];
      setActiveBusinessId(activeM.business_id);
      try {
        localStorage.setItem(STORAGE_KEY, activeM.business_id);
      } catch {
        // Ignore
      }

      await loadBusinessDetails(activeM.business_id);
    } catch (err: any) {
      setError(err.message || 'Error al obtener tus negocios autorizados (/v1/me).');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, isMockMode, loadBusinessDetails]);

  useEffect(() => {
    initBusinessFlow();
  }, [initBusinessFlow]);

  const activeRole = React.useMemo(() => {
    if (!activeBusinessId) return null;
    const found = memberships.find((m) => m.business_id === activeBusinessId);
    return found ? found.role : null;
  }, [activeBusinessId, memberships]);

  const value: BusinessContextType = {
    activeBusinessId,
    activeBusiness,
    activeRole,
    memberships,
    isLoading,
    error,
    selectBusiness,
    refreshBusinessData: initBusinessFlow,
  };

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
};

export function useBusiness(): BusinessContextType {
  const context = useContext(BusinessContext);
  if (!context) {
    throw new Error('useBusiness must be used within a BusinessProvider');
  }
  return context;
}
