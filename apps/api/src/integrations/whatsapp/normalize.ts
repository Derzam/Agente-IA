import { z } from 'zod';
import { digest } from '../../platform/idempotency.js';
import { validation } from '../../platform/errors.js';
import type { NormalizedEvent } from '../../modules/inbox/domain/inbound-event.js';
export type { NormalizedEvent } from '../../modules/inbox/domain/inbound-event.js';

type RecordValue = Record<string, unknown>;
const id = z.string().min(1).max(512);
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const optionalString = (value: unknown, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
const eventKey = (...parts: string[]) => parts.map(encodeURIComponent).join(':');
const envelopeSchema = z.looseObject({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.looseObject({
    changes: z.array(z.looseObject({
      field: z.string().max(128),
      value: z.looseObject({
        metadata: z.looseObject({ phone_number_id: id }).optional(),
        messages: z.array(z.unknown()).max(1000).optional(),
        statuses: z.array(z.unknown()).max(1000).optional()
      })
    })).max(1000)
  })).max(1000)
});
function boundedStructure(value: unknown, depth = 0, counter = { nodes: 0 }): void {
  if (++counter.nodes > 30_000 || depth > 32) throw validation();
  if (value && typeof value === 'object') for (const child of Object.values(value)) boundedStructure(child, depth + 1, counter);
}
function timestamp(value: unknown, now: number): { value: string | null; quarantine: string | null } {
  if (typeof value !== 'string' || !/^\d{1,13}$/.test(value)) return { value: null, quarantine: 'INVALID_TIMESTAMP' };
  const ms = Number(value) * 1000;
  if (!Number.isSafeInteger(ms) || ms > 8_640_000_000_000_000) return { value: null, quarantine: 'INVALID_TIMESTAMP' };
  return { value: new Date(ms).toISOString(), quarantine: ms > now + 300_000 ? 'FUTURE_TIMESTAMP' : ms < now - 90 * 86400_000 ? 'STALE_TIMESTAMP' : null };
}
function makeEvent(phone: string, key: string, eventType: NormalizedEvent['eventType'], payload: NormalizedEvent['payload'], quarantine: string | null): NormalizedEvent {
  return { phoneNumberId: phone, eventKey: key, eventType, payload, payloadHash: digest(payload), quarantine };
}
function unsupported(phone: string, raw: unknown): NormalizedEvent {
  return makeEvent(phone, eventKey('wa','unsupported',phone,digest(raw)), 'unsupported', {
    phone_number_id: phone, provider_message_id: null, channel_user_id: null,
    provider_timestamp: null, kind: 'unsupported', content: { reason: 'UNKNOWN_PROVIDER_SHAPE' }
  }, 'UNSUPPORTED_SHAPE');
}
function message(phone: string, raw: unknown, now: number): NormalizedEvent {
  const m = record(raw);
  const messageId = optionalString(m.id);
  if (!messageId) return unsupported(phone, raw);
  const time = timestamp(m.timestamp, now);
  const userId = optionalString(m.from, 256) ?? optionalString(m.from_user_id, 256);
  let kind: NormalizedEvent['payload']['kind'] = 'unsupported';
  let content: RecordValue = { provider_type: optionalString(m.type, 64) ?? 'unknown' };
  const text = record(m.text);
  if (m.type === 'text' && typeof text.body === 'string') {
    kind = 'text'; content = { text: text.body.slice(0, 2000), truncated: text.body.length > 2000 };
  } else if (m.type === 'interactive') {
    const interactive = record(m.interactive);
    const reply = record(interactive.type === 'button_reply' ? interactive.button_reply : interactive.type === 'list_reply' ? interactive.list_reply : null);
    if (optionalString(reply.id)) {
      kind = 'interactive'; content = { reply_id: reply.id, title: optionalString(reply.title, 200) };
    }
  } else if (m.type === 'location') {
    const location = record(m.location);
    const parsed = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).safeParse(location);
    if (parsed.success) {
      kind = 'location'; content = { ...parsed.data, name: optionalString(location.name, 120), address: optionalString(location.address, 1000) };
    }
  }
  return makeEvent(phone, eventKey('wa','message',phone,messageId), 'message', {
    phone_number_id: phone, provider_message_id: messageId, channel_user_id: userId,
    provider_timestamp: time.value, kind, content
  }, time.quarantine ?? (userId ? null : 'MISSING_SENDER'));
}
function status(phone: string, raw: unknown, now: number): NormalizedEvent {
  const s = record(raw);
  const messageId = optionalString(s.id);
  const statusValue = optionalString(s.status, 64);
  if (!messageId || !statusValue || typeof s.timestamp !== 'string' || !/^\d{1,13}$/.test(s.timestamp)) return unsupported(phone, raw);
  const time = timestamp(s.timestamp, now);
  const codes = Array.isArray(s.errors) ? [...new Set(s.errors.map(e => record(e).code).filter((code): code is number => typeof code === 'number' && Number.isSafeInteger(code)))].sort((a,b) => a-b).slice(0,20) : [];
  return makeEvent(phone, eventKey('wa','status',phone,messageId,statusValue,s.timestamp,codes.join(',') || 'none'), 'status', {
    phone_number_id: phone, provider_message_id: messageId, channel_user_id: optionalString(s.recipient_id, 256),
    provider_timestamp: time.value, kind: 'status', content: { status: statusValue, error_codes: codes }
  }, time.quarantine);
}
export function normalizeEnvelope(raw: unknown, now = Date.now()): { events: NormalizedEvent[]; ignoredChanges: number } {
  boundedStructure(raw);
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw validation();
  const events: NormalizedEvent[] = [];
  let ignoredChanges = 0;
  for (const entry of parsed.data.entry) for (const change of entry.changes) {
    const phone = change.value.metadata?.phone_number_id;
    if (!phone) { ignoredChanges++; continue; }
    if (change.field !== 'messages') { events.push(unsupported(phone, change)); continue; }
    for (const m of change.value.messages ?? []) events.push(message(phone, m, now));
    for (const s of change.value.statuses ?? []) events.push(status(phone, s, now));
    if (!change.value.messages?.length && !change.value.statuses?.length) events.push(unsupported(phone, change));
  }
  if (events.length > 2000) throw validation();
  return { events, ignoredChanges };
}
