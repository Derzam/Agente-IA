import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { SupabaseJwtVerifier } from '../src/integrations/supabase/auth.js';
import { userA } from './helpers.js';

test('remote JWKS uses fixed issuer endpoint and verifies authentic signatures',async t=>{
  const key=await generateKeyPair('ES256');const jwk=await exportJWK(key.publicKey);jwk.kid='remote-test-key';
  const paths:string[]=[];
  const server=createServer((request,response)=>{paths.push(request.url!);response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({keys:[jwk]}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address && typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
  const token=await new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:jwk.kid,jku:'https://evil.example/keys'})
    .setIssuer(url+'/auth/v1').setAudience('authenticated').setSubject(userA).setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
  assert.deepEqual(await new SupabaseJwtVerifier(url).verify(token),{userId:userA});
  assert.deepEqual(paths,['/auth/v1/.well-known/jwks.json']);
});
test('JWKS dependency failure returns safe retryable 503',async t=>{
  const key=await generateKeyPair('ES256');
  const server=createServer((_request,response)=>{response.writeHead(503);response.end('private provider failure');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address && typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
  const token=await new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:'test'})
    .setIssuer(url+'/auth/v1').setAudience('authenticated').setSubject(userA).setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
  await assert.rejects(()=>new SupabaseJwtVerifier(url).verify(token),{status:503,code:'PROVIDER_UNAVAILABLE',retryable:true});
});
