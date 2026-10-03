import type { Business, Me, Membership } from '@agente-ia/shared';
import type pg from 'pg';
import { transaction, userContext } from '../../../platform/database.js';
import { unavailable } from '../../../platform/errors.js';
import type { IdentityRepository } from '../application/ports.js';

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly pool: pg.Pool) {}
  async getMe(userId: string): Promise<Me> {
    return transaction(this.pool, async client => {
      await userContext(client, userId);
      const rows = await client.query<Membership>(`
        SELECT m.business_id, m.role FROM app.business_memberships m
        JOIN app.businesses b ON b.id=m.business_id
        WHERE m.user_id=$1 AND m.active AND b.status='active' AND b.deleted_at IS NULL
        ORDER BY m.business_id LIMIT 101`, [userId]);
      if (rows.rows.length > 100) throw unavailable(); // Canonical DTO has maxItems=100, no silent truncation.
      return { user_id: userId, memberships: rows.rows };
    });
  }
  async getBusiness(userId: string, businessId: string): Promise<Business | null> {
    return transaction(this.pool, async client => {
      await userContext(client, userId, businessId);
      const result = await client.query<Omit<Business, 'created_at' | 'updated_at'> & { created_at: Date; updated_at: Date }>(`
        SELECT b.id,b.id AS business_id,b.name,b.slug,b.currency,b.timezone,b.status,b.version,b.created_at,b.updated_at
        FROM app.businesses b JOIN app.business_memberships m ON m.business_id=b.id
        WHERE b.id=$1 AND m.user_id=$2 AND m.active AND b.deleted_at IS NULL`, [businessId, userId]);
      const row = result.rows[0];
      return row ? { ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() } : null;
    });
  }
}
