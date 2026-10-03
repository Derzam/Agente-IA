import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { AppError, unauthenticated, unavailable } from '../../platform/errors.js';

export interface Identity { userId: string }
export interface AuthVerifier { verify(token: string): Promise<Identity> }

export class SupabaseJwtVerifier implements AuthVerifier {
  private readonly issuer: string;
  private readonly key: JWTVerifyGetKey;
  constructor(supabaseUrl: string, key?: JWTVerifyGetKey) {
    this.issuer = `${supabaseUrl}/auth/v1`;
    this.key = key ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
      timeoutDuration: 3000, cooldownDuration: 30_000, cacheMaxAge: 600_000
    });
  }
  async verify(token: string): Promise<Identity> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'iss', 'aud'], clockTolerance: 5
      });
      // Anonymous Auth sessions and API/service tokens are not admin users.
      if (payload.role !== 'authenticated' || (payload.is_anonymous !== undefined && payload.is_anonymous !== false) || !z.uuid().safeParse(payload.sub).success) throw unauthenticated();
      return { userId: payload.sub! };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid || error instanceof errors.JWKInvalid ||
          (error instanceof errors.JOSEError && error.code === 'ERR_JOSE_GENERIC') || !(error instanceof errors.JOSEError)) throw unavailable();
      throw unauthenticated();
    }
  }
}
