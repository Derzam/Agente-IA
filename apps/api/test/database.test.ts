import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createLocalJWKSet, generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createPool, transaction, userContext, checkDatabaseRole } from '../src/platform/database.js';
import { PostgresInboxRepository } from '../src/modules/inbox/infrastructure/postgres-inbox.js';
import { PostgresIdentityRepository } from '../src/modules/identity/infrastructure/postgres-identity.js';
import { SupabaseJwtVerifier } from '../src/integrations/supabase/auth.js';
import { buildApp } from '../src/bootstrap/app.js';
import { normalizeEnvelope } from '../src/integrations/whatsapp/normalize.js';
import { config, envelope, signature, textMessage, userA, userB, businessA, businessB } from './helpers.js';
import { assertContract } from './schema.js';

const input=process.env.TEST_DATABASE_URL;
if(!input)throw new Error('TEST_DATABASE_URL required; run npm run api:test to provision isolated local PostgreSQL.');
const url=new URL(input);
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test')||url.search||url.hash||!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DB tests refuse non-loopback, non-test database or URL query overrides.');
const admin=new pg.Pool({connectionString:input});
const apiUrl=new URL(url);apiUrl.username='api_test';apiUrl.password='';
const ingressUrl=new URL(url);ingressUrl.username='ingress_test';ingressUrl.password='';
const api=createPool(apiUrl.toString());const ingress=createPool(ingressUrl.toString());
const inbox=new PostgresInboxRepository(ingress);const identities=new PostgresIdentityRepository(api);
const multi='33333333-3333-4333-8333-333333333333';const none='44444444-4444-4444-8444-444444444444';
const channelA='cccccccc-cccc-4ccc-8ccc-cccccccccccc';const channelB='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const keys=await generateKeyPair('ES256');const jwk=await exportJWK(keys.publicKey);jwk.kid='test-key';
const verifier=new SupabaseJwtVerifier(config.supabaseUrl,createLocalJWKSet({keys:[jwk]}));
async function token(user:string){return new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:'test-key'}).setSubject(user).setIssuer(config.supabaseUrl+'/auth/v1').setAudience('authenticated').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);}
let app:Awaited<ReturnType<typeof buildApp>>;
before(async()=>{
  const existing=await admin.query("SELECT to_regnamespace('app') AS schema");
  assert.equal(existing.rows[0].schema,null,'DB must be empty/disposable; no tables are dropped to prepare tests.');
  await admin.query('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)');
  // Minimal substitute for Supabase auth.users ONLY in isolated plain-Postgres tests.
  const migration=readFileSync(fileURLToPath(new URL('../../../supabase/migrations/20261003154547_backend_foundation.sql',import.meta.url)),'utf8');
  await admin.query(migration);
  await admin.query(`CREATE ROLE api_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    CREATE ROLE ingress_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    GRANT app_api TO api_test; GRANT app_ingress TO ingress_test;`);
  await admin.query('INSERT INTO auth.users(id) VALUES($1),($2),($3),($4)',[userA,userB,multi,none]);
  await admin.query(`INSERT INTO app.businesses(id,name,slug,currency,timezone) VALUES
    ($1,'Synthetic A','synthetic-a','USD','America/Guayaquil'),($2,'Synthetic B','synthetic-b','USD','America/Guayaquil')`,[businessA,businessB]);
  await admin.query(`INSERT INTO app.business_memberships(business_id,user_id,role) VALUES ($1,$3,'owner'),($2,$4,'operator'),($1,$5,'manager'),($2,$5,'manager')`,[businessA,businessB,userA,userB,multi]);
  await admin.query(`INSERT INTO app.whatsapp_channels(id,business_id,phone_number_id,waba_id,app_reference) VALUES
    ($1,$3,'channel-a','waba-test-a','test-app'),($2,$4,'channel-b','waba-test-b','test-app')`,[channelA,channelB,businessA,businessB]);
  app=await buildApp({config,logger:false,auth:verifier,inbox,identities,readiness:async()=>{await Promise.all([checkDatabaseRole(api,'api'),checkDatabaseRole(ingress,'ingress')]);}});
});
after(async()=>{await app?.close();await Promise.all([api.end(),ingress.end(),admin.end()]);});

test('runtime DB roles are restricted, schema ready and migration enables FORCE RLS on all tables',async()=>{
  await checkDatabaseRole(api,'api');await checkDatabaseRole(ingress,'ingress');
  await assert.rejects(()=>checkDatabaseRole(admin,'api'));
  const tables=await admin.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND relkind='r'");
  assert.equal(tables.rowCount,4);assert.ok(tables.rows.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
  assert.equal((await app.inject('/ready')).statusCode,200);
});
test('real PostgreSQL: repeated and regrouped envelopes insert one message effect',async()=>{
  const m=textMessage('wamid.db.duplicate');
  for(const payload of [envelope([m]),envelope([m]),envelope([m,textMessage('wamid.db.extra')])]){
    const raw=JSON.stringify({...payload,business_id:businessB});
    assert.equal((await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)},payload:raw})).statusCode,200);
  }
  const stored=await admin.query("SELECT business_id,payload,status FROM app.webhook_events WHERE event_key=$1",[`wa:message:channel-a:${m.id}`]);
  assert.equal(stored.rowCount,1);assert.equal(stored.rows[0].business_id,businessA);assert.equal(stored.rows[0].status,'pending');assert.equal(stored.rows[0].payload.business_id,undefined);
});
test('20 simultaneous copies yield exactly one durable inbox row',async()=>{
  const events=normalizeEnvelope(envelope([textMessage('wamid.concurrent')])).events;
  const results=await Promise.all(Array.from({length:20},()=>inbox.ingest(events)));
  assert.equal(results.reduce((sum,r)=>sum+r.inserted,0),1);assert.equal(results.reduce((sum,r)=>sum+r.duplicates,0),19);
});
test('multiple messages and statuses across tenants are durably committed with independent keys',async()=>{
  const timestamp=String(Math.floor(Date.now()/1000));
  const raw=envelope([textMessage('wamid.batch.a')],[{id:'wamid.batch.a',status:'sent',timestamp},{id:'wamid.batch.a',status:'read',timestamp}]);
  raw.entry.push(...envelope([textMessage('wamid.batch.b')],[],'channel-b').entry);
  const first=await inbox.ingest(normalizeEnvelope(raw).events);const second=await inbox.ingest(normalizeEnvelope(raw).events);
  assert.equal(first.inserted,4);assert.equal(second.inserted,0);assert.equal(second.duplicates,4);
});
test('unknown/disabled channel yields 200, logs configuration issue and creates no tenant/event',async()=>{
  const beforeCount=await admin.query('SELECT count(*)::int AS count FROM app.webhook_events');
  const raw=JSON.stringify(envelope([textMessage('unknown')],[],'not-configured'));
  assert.equal((await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)},payload:raw})).statusCode,200);
  const result=await inbox.ingest(normalizeEnvelope(envelope([textMessage('unknown-2')],[],'not-configured')).events);
  assert.deepEqual(result.unknownChannels,['not-configured']);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM app.businesses')).rows[0].count,2);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM app.webhook_events')).rows[0].count,beforeCount.rows[0].count);
  await admin.query('UPDATE app.whatsapp_channels SET enabled=false WHERE id=$1',[channelB]);
  try { assert.deepEqual((await inbox.ingest(normalizeEnvelope(envelope([textMessage('disabled')],[],'channel-b')).events)).unknownChannels,['channel-b']); }
  finally { await admin.query('UPDATE app.whatsapp_channels SET enabled=true WHERE id=$1',[channelB]); }
});
test('a failure in one event rolls back the complete batch, no false ACK partial persistence',async()=>{
  const events=normalizeEnvelope(envelope([textMessage('wamid.rollback.a'),textMessage('wamid.rollback.z')])).events;
  events[1]!.payloadHash='invalid';await assert.rejects(()=>inbox.ingest(events));
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM app.webhook_events WHERE event_key LIKE '%wamid.rollback.%'")).rows[0].count,0);
});
test('real signed JWTs: me returns own active memberships, multiple businesses or empty list',async()=>{
  for(const [user,expected] of [[userA,1],[multi,2],[none,0]] as const){
    const result=await app.inject({url:'/v1/me',headers:{authorization:'Bearer '+await token(user)}});
    assert.equal(result.statusCode,200);assert.equal(result.json().data.user_id,user);assert.equal(result.json().data.memberships.length,expected);
    for(const row of result.json().data.memberships)assert.deepEqual(Object.keys(row).sort(),['business_id','role']);
  }
});
test('tenant isolation at HTTP and DB: A cannot read B even with forged tenant context',async()=>{
  const own=await app.inject({url:`/v1/businesses/${businessA}`,headers:{authorization:'Bearer '+await token(userA)}});
  assert.equal(own.statusCode,200);
  assertContract('BusinessResponse',own.json());
  const other=await app.inject({url:`/v1/businesses/${businessB}`,headers:{authorization:'Bearer '+await token(userA),'x-business-id':businessB}});
  assert.equal(other.statusCode,404);assert.ok(!other.body.includes('Synthetic B'));
  await assert.rejects(()=>transaction(api,async client=>{
    await userContext(client,userA,businessB);
    assert.equal((await client.query('SELECT id FROM app.businesses')).rowCount,0);
    assert.equal((await client.query('SELECT user_id FROM app.business_memberships WHERE user_id=$1',[userB])).rowCount,0);
    await client.query('INSERT INTO app.businesses(name,slug,currency,timezone) VALUES($1,$2,$3,$4)',['forbidden','forbidden','USD','UTC']);
  }),{code:'42501'});
});
test('pool transaction context resets and revoked membership is not authorized by old JWT',async()=>{
  assert.ok(await identities.getBusiness(userA,businessA));assert.ok(await identities.getBusiness(userB,businessB));
  await admin.query('UPDATE app.business_memberships SET active=false WHERE user_id=$1 AND business_id=$2',[userA,businessA]);
  try{
    const me=await app.inject({url:'/v1/me',headers:{authorization:'Bearer '+await token(userA)}});assert.deepEqual(me.json().data.memberships,[]);
    assert.equal((await app.inject({url:`/v1/businesses/${businessA}`,headers:{authorization:'Bearer '+await token(userA)}})).statusCode,404);
  }finally{await admin.query('UPDATE app.business_memberships SET active=true WHERE user_id=$1 AND business_id=$2',[userA,businessA]);}
  const context=await api.query("SELECT nullif(current_setting('app.user_id',true),'') AS actor");assert.equal(context.rows[0].actor,null);
});
test('composite tenant FK and RLS WITH CHECK reject cross-tenant inserts',async()=>{
  const event=normalizeEnvelope(envelope([textMessage('wamid.fk')])).events[0]!;
  await assert.rejects(()=>admin.query(`INSERT INTO app.webhook_events(business_id,channel_id,event_key,event_type,payload,payload_hash)
    VALUES($1,$2,$3,'message',$4,$5)`,[businessA,channelB,event.eventKey,event.payload,event.payloadHash]),{code:'23503'});
  await assert.rejects(()=>transaction(ingress,async client=>{
    await client.query("SELECT set_config('app.business_id',$1,true)",[businessA]);
    await client.query(`INSERT INTO app.webhook_events(business_id,channel_id,event_key,event_type,payload,payload_hash)
      VALUES($1,$2,$3,'message',$4,$5)`,[businessB,channelB,event.eventKey,event.payload,event.payloadHash]);
  }),{code:'42501'});
});
test('ingress cannot write catalog/memberships or delete inbox; API cannot read inbox',async()=>{
  await assert.rejects(()=>ingress.query('SELECT * FROM app.business_memberships'),{code:'42501'});
  await assert.rejects(()=>ingress.query('DELETE FROM app.webhook_events'),{code:'42501'});
  await assert.rejects(()=>api.query('SELECT * FROM app.webhook_events'),{code:'42501'});
});
test('anon/authenticated have no direct schema grant; RLS ingress context cannot read another tenant',async()=>{
  for(const role of ['anon','authenticated']){
    const client=await admin.connect();
    try { await client.query(role==='anon'?'SET ROLE anon':'SET ROLE authenticated');await assert.rejects(()=>client.query('SELECT * FROM app.businesses'),{code:'42501'}); }
    finally { await client.query('RESET ROLE');client.release(); }
  }
  await transaction(ingress,async client=>{
    await client.query("SELECT set_config('app.business_id',$1,true)",[businessA]);
    assert.equal((await client.query('SELECT id FROM app.webhook_events WHERE business_id=$1',[businessB])).rowCount,0);
  });
});
test('actual socket server responds over HTTP on loopback with verified JWT',async()=>{
  const address=await app.listen({host:'127.0.0.1',port:0});
  const response=await fetch(address+'/v1/me',{headers:{authorization:'Bearer '+await token(userA)}});
  assert.equal(response.status,200);assert.equal((await response.json()).data.user_id,userA);
});
test('real PostgreSQL connection failure becomes 503 rather than an ACK',async()=>{
  const failed=createPool('postgres://ingress_test@127.0.0.1:1/agente_ia_test');
  const isolated=await buildApp({config,logger:false,auth:verifier,identities,inbox:new PostgresInboxRepository(failed),readiness:()=>checkDatabaseRole(failed,'ingress')});
  try{
    const raw=JSON.stringify(envelope([textMessage('db.unavailable')]));
    const res=await isolated.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)},payload:raw});
    assert.equal(res.statusCode,503);assertContract('ApiError',res.json());assert.equal((await isolated.inject('/ready')).statusCode,503);
  }finally{await isolated.close();await failed.end();}
});
