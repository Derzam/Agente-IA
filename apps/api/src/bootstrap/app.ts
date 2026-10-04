import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config/env.js';
import type { AuthVerifier } from '../integrations/supabase/auth.js';
import type { IdentityRepository } from '../modules/identity/application/ports.js';
import type { InboxRepository } from '../modules/inbox/application/ports.js';
import { registerWhatsAppRoutes } from '../integrations/whatsapp/routes.js';
import { registerIdentityRoutes } from '../modules/identity/http/routes.js';
import { AppError, errorEnvelope, unavailable, validation } from '../platform/errors.js';
import type pg from 'pg';
import { registerDomainRoutes } from '../modules/domain/http/routes.js';

export interface AppDependencies {
  config: Config;
  auth: AuthVerifier;
  identities: IdentityRepository;
  inbox: InboxRepository;
  readiness: () => Promise<void>;
  close?: () => Promise<void>;
  logger?: FastifyServerOptions['logger'];
  rateLimitMax?: number;
  domainPool?: pg.Pool;
}
export async function buildApp(deps: AppDependencies) {
  const app = Fastify({
    bodyLimit: 1024 * 1024, requestTimeout: 15_000, connectionTimeout: 15_000,
    trustProxy: false, requestIdHeader: false, genReqId: () => randomUUID(), logController: new LogController({ disableRequestLogging: true }),
    logger: deps.logger ?? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.headers["set-cookie"]'] }
  });
  app.addHook('onRequest', async (request, reply) => { reply.header('X-Request-Id', request.id); });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ request_id: request.id, route: request.routeOptions.url ?? 'unmatched', status_code: reply.statusCode, duration_ms: reply.elapsedTime }, 'http.completed');
  });
  app.setErrorHandler((error, request, reply) => {
    const framework: { code?: string; statusCode?: number } = error instanceof Error ? error as Error & { code?: string; statusCode?: number } : {};
    let safe: AppError;
    if (error instanceof AppError) safe = error;
    else if (framework.code === 'FST_ERR_CTP_BODY_TOO_LARGE') safe = new AppError(413, 'VALIDATION_ERROR', 'Payload demasiado grande.');
    else if (framework.statusCode === 429) safe = new AppError(429, 'RATE_LIMITED', 'Demasiadas solicitudes.', true);
    else if (framework.statusCode && framework.statusCode >= 400 && framework.statusCode < 500) safe = validation();
    else safe = new AppError(500, 'INTERNAL_ERROR', 'Error interno.');
    request.log.warn({ request_id: request.id, error_code: safe.code, route: request.routeOptions.url ?? 'unmatched' }, 'http.error');
    if (safe.retryable) reply.header('Retry-After', safe.status === 429 ? '60' : '3');
    reply.code(safe.status).send(errorEnvelope(safe, request.id));
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send(errorEnvelope(new AppError(404, 'NOT_FOUND', 'Recurso no encontrado.'), request.id)));
  await app.register(helmet);
  await app.register(cors, {
    origin: deps.config.adminAllowedOrigins, credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Idempotency-Replayed']
  });
  await app.register(rateLimit, { max: deps.rateLimitMax ?? 120, timeWindow: '1 minute' });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: { rateLimit: false } }, async () => {
    try { await deps.readiness(); } catch { throw unavailable(); }
    return { status: 'ready' };
  });

  registerIdentityRoutes(app, deps.auth, deps.identities,!deps.domainPool);
  if(deps.domainPool) registerDomainRoutes(app,deps.auth,deps.domainPool);
  await registerWhatsAppRoutes(app, deps.config, deps.inbox);
  if (deps.close) app.addHook('onClose', deps.close);
  return app;
}
