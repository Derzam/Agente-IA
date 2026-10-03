import type { Customer as DTOCustomer } from '@agente-ia/shared';
import type { Customer as ViewModelCustomer } from '@/types/viewModels';

/**
 * Maps canonical DTO Customer to ViewModel Customer.
 * Strictly respects phone_masked without inventing unmasked PII.
 */
export function mapDtoCustomerToViewModel(
  dto: DTOCustomer,
  aggregates?: { totalOrders?: number; totalSpent?: number }
): ViewModelCustomer {
  return {
    id: dto.id,
    phone: dto.phone_masked || 'Protegido / Enmascarado',
    name: dto.display_name || 'Cliente WhatsApp',
    totalOrdersCount: aggregates?.totalOrders ?? 0,
    totalSpent: aggregates?.totalSpent ?? 0,
    firstInteractionAt: dto.created_at,
    lastInteractionAt: dto.updated_at,
    isVip: false,
    notes: undefined,
  };
}
