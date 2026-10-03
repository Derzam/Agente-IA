import type pg from 'pg';
import type { NormalizedEvent } from '../domain/inbound-event.js';
import { transaction } from '../../../platform/database.js';
import type { InboxRepository, IngestResult } from '../application/ports.js';

export class PostgresInboxRepository implements InboxRepository {
  constructor(private readonly pool: pg.Pool) {}
  async ingest(events: NormalizedEvent[]): Promise<IngestResult> {
    return transaction(this.pool, async client => {
      const result: IngestResult = { inserted: 0, duplicates: 0, unknownChannels: [] };
      const channels = new Map<string, { id: string; business_id: string } | null>();
      const businessIds = new Set<string>();
      // Canonical acquisition order reduces deadlocks for overlapping multi-event batches.
      for (const event of [...events].sort((a,b) => a.eventKey.localeCompare(b.eventKey))) {
        if (!channels.has(event.phoneNumberId)) {
          const rows = await client.query<{ id: string; business_id: string }>(`
            SELECT c.id,c.business_id FROM app.whatsapp_channels c JOIN app.businesses b ON b.id=c.business_id
            WHERE c.phone_number_id=$1 AND c.enabled AND b.status='active' AND b.deleted_at IS NULL`, [event.phoneNumberId]);
          channels.set(event.phoneNumberId, rows.rows[0] ?? null);
        }
        const channel = channels.get(event.phoneNumberId);
        if (!channel) { result.unknownChannels.push(event.phoneNumberId); continue; }
        businessIds.add(channel.business_id);
        await client.query("SELECT set_config('app.business_id', $1, true)", [channel.business_id]);
        const inserted = await client.query(`
          INSERT INTO app.webhook_events(business_id,channel_id,event_key,event_type,payload,payload_hash,status,last_error_code)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
          ON CONFLICT(business_id,event_key) DO NOTHING RETURNING id`, [channel.business_id, channel.id, event.eventKey,
          event.eventType, JSON.stringify(event.payload), event.payloadHash, event.quarantine ? 'dead_letter' : 'pending', event.quarantine]);
        if (inserted.rowCount) result.inserted++; else result.duplicates++;
      }
      result.businessIds = [...businessIds];
      return result;
    });
  }
}
