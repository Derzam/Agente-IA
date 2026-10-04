import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthVerifier, Identity } from '../../../integrations/supabase/auth.js';
import type { IdentityRepository } from '../application/ports.js';
import { AppError, unauthenticated, unavailable } from '../../../platform/errors.js';

export function registerIdentityRoutes(app: FastifyInstance, auth: AuthVerifier, identities: IdentityRepository,includeBusiness=true): void {
  async function authenticate(request: FastifyRequest): Promise<Identity> {
    const authorization = request.headers.authorization;
    if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._-]+$/i.test(authorization)) throw unauthenticated();
    return auth.verify(authorization.slice(7));
  }
  app.get('/v1/me', async request => {
    const identity = await authenticate(request);
    let data;
    try { data = await identities.getMe(identity.userId); } catch { throw unavailable(); }
    return { data, meta: { request_id: request.id } };
  });
  if(!includeBusiness)return;
  app.get<{ Params: { business_id: string } }>('/v1/businesses/:business_id', async request => {
    const identity = await authenticate(request);
    if (!z.uuid().safeParse(request.params.business_id).success) throw new AppError(422, 'VALIDATION_ERROR', 'Identificador inválido.');
    let data;
    try { data = await identities.getBusiness(identity.userId, request.params.business_id); } catch { throw unavailable(); }
    if (!data) throw new AppError(404, 'NOT_FOUND', 'Recurso no encontrado.');
    return { data, meta: { request_id: request.id } };
  });
}
