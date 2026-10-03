import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config/env.js';
import type { InboxRepository } from '../../modules/inbox/application/ports.js';
import { AppError, unauthenticated, unavailable, validation } from '../../platform/errors.js';
import { digest } from '../../platform/idempotency.js';
import { normalizeEnvelope } from './normalize.js';
import { safeTokenEqual, verifySignature } from './signature.js';

export async function registerWhatsAppRoutes(app: FastifyInstance, config: Config, inbox: InboxRepository): Promise<void> {
  app.get('/webhooks/whatsapp', async (request, reply) => {
    const query = z.object({ 'hub.mode': z.literal('subscribe'), 'hub.verify_token': z.string().max(512), 'hub.challenge': z.string().max(512) }).safeParse(request.query);
    if (!query.success) throw validation();
    if (!safeTokenEqual(query.data['hub.verify_token'], config.whatsappVerifyToken)) throw new AppError(403, 'FORBIDDEN', 'Verificación rechazada.');
    return reply.type('text/plain').send(query.data['hub.challenge']);
  });
  // The encapsulated parser preserves raw bytes only for Meta, not other API routes.
  await app.register(async webhook => {
    webhook.removeAllContentTypeParsers();
    webhook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    webhook.post('/webhooks/whatsapp', async request => {
      if (!Buffer.isBuffer(request.body) || !verifySignature(request.body, request.headers['x-hub-signature-256'], config.whatsappAppSecret)) throw unauthenticated();
      let parsed: unknown;
      try { parsed = JSON.parse(request.body.toString('utf8')); } catch { throw validation(); }
      const { events, ignoredChanges } = normalizeEnvelope(parsed);
      let result;
      try { result = await inbox.ingest(events); } catch { throw unavailable(); }
      for (const phone of new Set(result.unknownChannels)) request.log.warn({ request_id: request.id, provider: 'whatsapp', event_type: 'unknown_channel', channel_hash: digest(phone) }, 'whatsapp.configuration_issue');
      if (ignoredChanges) request.log.warn({ request_id: request.id, provider: 'whatsapp', event_type: 'unroutable_change', count: ignoredChanges }, 'whatsapp.configuration_issue');
      request.log.info({ request_id: request.id, provider: 'whatsapp', event_type: 'inbox.committed', inserted: result.inserted, duplicates: result.duplicates }, 'whatsapp.inbox');
      for (const businessId of result.businessIds ?? []) request.log.info({ request_id: request.id, business_id: businessId, provider: 'whatsapp', event_type: 'inbox.committed' }, 'whatsapp.tenant_inbox');
      return { status: 'received' };
    });
  });
}
