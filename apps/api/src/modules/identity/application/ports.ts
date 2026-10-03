import type { Business, Me } from '@agente-ia/shared';

export interface IdentityRepository {
  getMe(userId: string): Promise<Me>;
  getBusiness(userId: string, businessId: string): Promise<Business | null>;
}
