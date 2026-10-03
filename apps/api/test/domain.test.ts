import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, createLocalJWKSet, exportJWK, SignJWT } from 'jose';
import { SupabaseJwtVerifier } from '../src/integrations/supabase/auth.js';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { normalizeEnvelope } from '../src/integrations/whatsapp/normalize.js';
import { digest } from '../src/platform/idempotency.js';
import { config, envelope, textMessage, userA } from './helpers.js';

const environment = () => ({ NODE_ENV:'test', DATABASE_URL:config.databaseUrl, WEBHOOK_DATABASE_URL:config.webhookDatabaseUrl,
  SUPABASE_URL:config.supabaseUrl, WHATSAPP_VERIFY_TOKEN:config.whatsappVerifyToken, WHATSAPP_APP_SECRET:config.whatsappAppSecret, ADMIN_ALLOWED_ORIGINS:config.adminAllowedOrigins.join(',') });
test('configuration fails fast without required fields and does not echo supplied secrets',()=>{
  for(const field of ['DATABASE_URL','WEBHOOK_DATABASE_URL','SUPABASE_URL','WHATSAPP_VERIFY_TOKEN','WHATSAPP_APP_SECRET','ADMIN_ALLOWED_ORIGINS']){
    const env:Record<string,string> = environment();delete env[field];
    assert.throws(()=>loadConfig(env),error=>error instanceof ConfigurationError && error.message.includes(field) && !error.message.includes(config.whatsappAppSecret));
  }
});
test('foundation configuration does not require unused Meta sending/OpenAI/service_role keys',()=>{
  const result=loadConfig(environment());assert.equal(result.port,3000);assert.equal(result.supabaseUrl,config.supabaseUrl);
});
test('configuration rejects privileged DB, wildcard CORS and unverified remote TLS',()=>{
  for(const partial of [
    {DATABASE_URL:'postgres://postgres@127.0.0.1/db'},
    {DATABASE_URL:'postgres://api@db.example/db?sslmode=require'},
    {ADMIN_ALLOWED_ORIGINS:'*'},
    {ADMIN_ALLOWED_ORIGINS:'https://admin.example/path'},
    {SUPABASE_URL:'http://remote.example'},
    {NODE_ENV:'production',ADMIN_ALLOWED_ORIGINS:'http://localhost:5173'}
  ])assert.throws(()=>loadConfig({...environment(),...partial}),ConfigurationError);
});
test('normalizer visits multiple entries/changes/messages/statuses and ignores untrusted business_id',()=>{
  const timestamp=String(Math.floor(Date.now()/1000));
  const raw=envelope([textMessage('m1'),textMessage('m2')],[{id:'m1',status:'sent',timestamp,recipient_id:'customer'},{id:'m1',status:'read',timestamp}]);
  raw.entry.push(...envelope([textMessage('m3')],[],'channel-b').entry);
  raw.entry[0]!.changes.push(...envelope([textMessage('m4')]).entry[0]!.changes);
  const parsed=normalizeEnvelope({...raw,business_id:'fake'});
  assert.equal(parsed.events.length,6);assert.deepEqual(new Set(parsed.events.map(e=>e.phoneNumberId)),new Set(['channel-a','channel-b']));
  assert.ok(!JSON.stringify(parsed).includes('fake'));
});
test('interactive, location and media normalize without downloading or keeping media URLs',()=>{
  const base=textMessage();
  const raw=envelope([
    {...base,id:'interactive',type:'interactive',interactive:{type:'button_reply',button_reply:{id:'opaque-reply',title:'Confirmar'}}},
    {...base,id:'location',type:'location',location:{latitude:-2.1,longitude:-79.9}},
    {...base,id:'media',type:'audio',audio:{url:'https://sensitive-media.example/audio',id:'media-id'}},
    {...base,id:'bad-location',type:'location',location:{latitude:91,longitude:0}}
  ]);
  const {events}=normalizeEnvelope(raw);
  assert.deepEqual(events.map(e=>e.payload.kind),['interactive','location','unsupported','unsupported']);
  assert.ok(!JSON.stringify(events).includes('sensitive-media'));
});
test('event keys survive envelope regrouping/property order; status callbacks have separate identities',()=>{
  const m=textMessage('same');const timestamp=m.timestamp;
  const first=normalizeEnvelope(envelope([m],[{id:'same',status:'sent',timestamp},{id:'same',status:'delivered',timestamp}])).events;
  const regrouped=normalizeEnvelope(envelope([{text:m.text,type:m.type,timestamp:m.timestamp,from:m.from,id:m.id}])).events;
  assert.equal(first[0]!.eventKey,regrouped[0]!.eventKey);assert.equal(first[0]!.payloadHash,regrouped[0]!.payloadHash);
  assert.equal(new Set(first.map(e=>e.eventKey)).size,3);assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
});
test('stale/future/invalid timestamps quarantine; missing sender never invents a customer',()=>{
  for(const [timestamp,expected] of [['0','STALE_TIMESTAMP'],[String(Math.floor(Date.now()/1000)+600),'FUTURE_TIMESTAMP'],['NaN','INVALID_TIMESTAMP']]){
    assert.equal(normalizeEnvelope(envelope([{...textMessage(),timestamp}])).events[0]!.quarantine,expected);
  }
  const missing=normalizeEnvelope(envelope([{...textMessage(),from:undefined}])).events[0]!;
  assert.equal(missing.payload.channel_user_id,null);assert.equal(missing.quarantine,'MISSING_SENDER');
});
test('opaque provider IDs cannot collide through event-key delimiters',()=>{
  const a=normalizeEnvelope(envelope([textMessage('b')],[],'synthetic:a')).events[0]!;
  const b=normalizeEnvelope(envelope([textMessage('a:b')],[],'synthetic')).events[0]!;
  assert.notEqual(a.eventKey,b.eventKey);
});
test('deeply nested provider payload rejected; unknown shapes stored only as minimal hash key',()=>{
  let deep:unknown={};for(let i=0;i<40;i++)deep={nested:deep};
  assert.throws(()=>normalizeEnvelope({...envelope(),deep}));
  const unsupported=normalizeEnvelope(envelope([{unknown:'private-content'}])).events[0]!;
  assert.equal(unsupported.eventType,'unsupported');assert.ok(!JSON.stringify(unsupported).includes('private-content'));
});

const keys=await generateKeyPair('ES256');
const publicJwk=await exportJWK(keys.publicKey);publicJwk.kid='synthetic-key';
const verifier=new SupabaseJwtVerifier(config.supabaseUrl,createLocalJWKSet({keys:[publicJwk]}));
const issuer=config.supabaseUrl+'/auth/v1';
async function sign(overrides:Record<string,unknown>={}, key=keys.privateKey){
  return new SignJWT({role:'authenticated',is_anonymous:false,sub:userA,iss:issuer,aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...overrides})
    .setProtectedHeader({alg:'ES256',kid:'synthetic-key'}).sign(key);
}
test('Supabase JWT verifies real signature, issuer/audience/expiry and UUID subject',async()=>{
  assert.deepEqual(await verifier.verify(await sign()),{userId:userA});
});
test('JWT with bad signature is rejected',async()=>{
  const other=await generateKeyPair('ES256');await assert.rejects(()=>sign({},other.privateKey).then(token=>verifier.verify(token)),{code:'UNAUTHENTICATED'});
});
for(const [name,overrides] of Object.entries({issuer:{iss:'https://evil.example/auth/v1'},audience:{aud:'service_role'},expired:{exp:1},missingExpiry:{exp:undefined},subject:{sub:'not-uuid'},serviceRole:{role:'service_role'},anonymous:{is_anonymous:true}})){
  test(`JWT ${name} rejected`,async()=>{await assert.rejects(()=>sign(overrides).then(token=>verifier.verify(token)),{code:'UNAUTHENTICATED'});});
}
test('JWT frontend metadata does not produce application role or membership',async()=>{
  assert.deepEqual(await verifier.verify(await sign({user_metadata:{role:'owner',business_id:'fake'}})),{userId:userA});
});
