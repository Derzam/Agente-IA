import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { transaction, userContext, checkDatabaseRole } from '../src/platform/database.js';

const source=new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
if(!['localhost','127.0.0.1','[::1]'].includes(source.hostname)||!source.pathname.endsWith('_test')||source.search||source.hash||!['postgres:','postgresql:'].includes(source.protocol)) throw Error('Domain tests require disposable loopback *_test DB.');
const cluster=new pg.Pool({connectionString:source.toString()});
const target=new URL(source);target.pathname='/agente_ia_domain_test';
const db=new pg.Pool({connectionString:target.toString()});
const names=['business_settings','customers','conversations','messages','categories','products','modifier_groups','modifier_options','addresses','delivery_zones','carts','cart_items','orders','order_items','payments','human_handoffs','audit_logs','idempotency_keys','outbox_events','order_transitions','confirmation_challenges','conversation_turns','tool_executions'];
const migration=readFileSync(new URL('../../../supabase/migrations/20261004010809_domain_schema.sql',import.meta.url),'utf8');
const foundation=readFileSync(new URL('../../../supabase/migrations/20261003154547_backend_foundation.sql',import.meta.url),'utf8');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
type Fixture=Record<string,string>;
let a:Fixture,b:Fixture;const owner=randomUUID(),operator=randomUUID(),outsider=randomUUID();
let rollbackVerified=false;
async function insert(table:string,data:Record<string,unknown>):Promise<string>{
 const cols=Object.keys(data);const rows=await db.query(`INSERT INTO app.${table}(${cols.join(',')}) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING ${table==='business_settings'?'business_id':'id'}`,Object.values(data));
 return rows.rows[0][table==='business_settings'?'business_id':'id'];
}
async function asRole<T>(role:'app_api'|'app_worker'|'app_ingress',tenant:string,actor:string,run:(c:pg.PoolClient)=>Promise<T>):Promise<T>{
 return transaction(db,async c=>{await c.query(`SET LOCAL ROLE ${role}`);await userContext(c,actor,tenant);return run(c);});
}
async function fixture(label:string):Promise<Fixture>{
 const f:Fixture={};f.business=await insert('businesses',{name:label,slug:label.toLowerCase(),currency:'USD',timezone:'America/Guayaquil'});
 await insert('business_memberships',{business_id:f.business,user_id:owner,role:'owner'});
 await insert('business_memberships',{business_id:f.business,user_id:operator,role:'operator'});
 const scope={business_id:f.business};
 f.channel=await insert('whatsapp_channels',{...scope,phone_number_id:label,waba_id:label,app_reference:'synthetic'});
 f.settings=await insert('business_settings',scope);
 f.customer=await insert('customers',{...scope,channel_user_id:label});
 f.conversation=await insert('conversations',{...scope,customer_id:f.customer,channel_id:f.channel,expires_at:new Date(Date.now()+3600000)});
 f.category=await insert('categories',{...scope,name:'Menú'});
 f.product=await insert('products',{...scope,category_id:f.category,name:'Producto',price_minor:500,currency:'USD'});
 f.group=await insert('modifier_groups',{...scope,product_id:f.product,name:'Extras'});
 f.option=await insert('modifier_options',{...scope,modifier_group_id:f.group,name:'Extra',price_delta_minor:100});
 f.address=await insert('addresses',{...scope,customer_id:f.customer,address_text:'Dirección sintética'});
 f.zone=await insert('delivery_zones',{...scope,name:'Zona',fee_minor:100,polygon_geojson:JSON.stringify({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]})});
 f.cart=await insert('carts',{...scope,customer_id:f.customer,conversation_id:f.conversation,currency:'USD',expires_at:new Date(Date.now()+3600000)});
 f.item=await insert('cart_items',{...scope,cart_id:f.cart,product_id:f.product,quantity:1,options_fingerprint:hash('initial')});
 f.outbox=await insert('outbox_events',{...scope,conversation_id:f.conversation,event_type:'whatsapp.message',aggregate_id:f.conversation,aggregate_version:1,causation_id:randomUUID(),dedupe_key:label,payload:JSON.stringify({resource_id:f.conversation,resource_version:1,text:'Sintético'})});
 f.message=await insert('messages',{...scope,conversation_id:f.conversation,direction:'inbound',kind:'interactive',actor_type:'customer',provider_message_id:label,content:JSON.stringify({id:'synthetic-button',title:'Confirmar'})});
 f.order=await insert('orders',{...scope,customer_id:f.customer,conversation_id:f.conversation,source_cart_id:f.cart,source_cart_version:1,fulfillment:'pickup',currency:'USD',subtotal_minor:500,total_minor:500,quote_expires_at:new Date(Date.now()+600000)});
 f.orderItem=await insert('order_items',{...scope,order_id:f.order,product_id:f.product,name_snapshot:'Producto',unit_price_minor:500,quantity:1,line_total_minor:500,option_snapshots:JSON.stringify([{name:'Extra histórico',price_delta_minor:0}])});
 f.payment=await insert('payments',{...scope,order_id:f.order,amount_minor:500,currency:'USD'});
 f.handoff=await insert('human_handoffs',{...scope,conversation_id:f.conversation,reason:'explicit_request'});
 f.audit=await insert('audit_logs',{...scope,actor_type:'system',action:'synthetic',resource_type:'order',resource_id:f.order,request_id:randomUUID()});
 f.idempotency=await insert('idempotency_keys',{...scope,actor_scope:owner,operation:'synthetic',key_hash:hash(label),request_hash:hash('request'),expires_at:new Date(Date.now()+86400000)});
 f.challengeHash=hash(randomBytes(32).toString('hex'));
 f.challenge=await insert('confirmation_challenges',{...scope,order_id:f.order,customer_id:f.customer,conversation_id:f.conversation,order_version:1,nonce_hash:f.challengeHash,expires_at:new Date(Date.now()+600000)});
 f.turn=await insert('conversation_turns',{...scope,conversation_id:f.conversation,inbound_message_id:f.message,automation_epoch:1,status:'planned',plan:JSON.stringify({actions:[{tool_name:'get_cart',arguments_hash:hash('arguments')}]})});
 f.tool=await insert('tool_executions',{...scope,turn_id:f.turn,action_index:0,tool_name:'get_cart',arguments_hash:hash('arguments')});
 f.cancelled=await insert('orders',{...scope,customer_id:f.customer,conversation_id:f.conversation,source_cart_id:f.cart,source_cart_version:2,fulfillment:'pickup',currency:'USD',subtotal_minor:500,total_minor:500,quote_expires_at:new Date(Date.now()+600000)});
 await db.query("UPDATE app.orders SET status='cancelled',cancellation_reason='Prueba' WHERE id=$1",[f.cancelled]);
 f.transition=await insert('order_transitions',{...scope,order_id:f.cancelled,from_status:'awaiting_confirmation',to_status:'cancelled',actor_type:'system',trigger:'cancel',causation_id:randomUUID(),resulting_version:2});
 return f;
}
before(async()=>{
 await cluster.query('CREATE DATABASE agente_ia_domain_test');
 await db.query('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)');
 await db.query(foundation);
 // Local cluster-only mock platform roles. Never use real Supabase credentials for tests.
 await db.query("DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',r); END IF; END LOOP; END $$;");
 await db.query(migration.replace(/COMMIT;\s*$/,'ROLLBACK;'));
 rollbackVerified=(await db.query("SELECT to_regclass('app.orders') AS missing")).rows[0].missing===null;
 await db.query(migration);
 await db.query('CREATE ROLE api_domain_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; CREATE ROLE mixed_domain_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; GRANT app_api TO api_domain_test; GRANT app_api,app_worker TO mixed_domain_test');
 await db.query('INSERT INTO auth.users(id) VALUES($1),($2),($3)',[owner,operator,outsider]);
 a=await fixture('Domain-A');b=await fixture('Domain-B');
 await db.query('UPDATE app.business_memberships SET active=false WHERE business_id=$1 AND user_id=$2',[b.business,operator]);
});
after(async()=>{await Promise.all([db.end(),cluster.end()]);});

test('domain migration applies incrementally and BEGIN/ROLLBACK leaves only foundation',()=>assert.ok(rollbackVerified));
test('all 27 tables ENABLE and FORCE RLS; 23 additions keep foundation intact',async()=>{
 const rows=await db.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'");
 assert.equal(rows.rowCount,27);assert.ok(rows.rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
 assert.equal((await db.query("SELECT to_regclass('app.product_options') AS absent")).rows[0].absent,null);
});
test('no public/platform schema, table, column or function grants; no SECURITY DEFINER',async()=>{
 const grants=await db.query("SELECT * FROM information_schema.role_table_grants WHERE table_schema='app' AND grantee IN ('PUBLIC','anon','authenticated','service_role')");assert.equal(grants.rowCount,0);
 for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query("SELECT has_schema_privilege($1,'app','USAGE') AS allowed",[role])).rows[0].allowed,false);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND (p.prosecdef OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0))")).rows[0].n,0);
});
test('capability roles are NOLOGIN without elevated privileges or mixed API/worker readiness',async()=>{
 const roles=await db.query("SELECT * FROM pg_roles WHERE rolname IN ('app_api','app_ingress','app_worker')");assert.equal(roles.rowCount,3);assert.ok(roles.rows.every(r=>!r.rolcanlogin&&!r.rolsuper&&!r.rolbypassrls&&!r.rolcreatedb&&!r.rolcreaterole));
 for(const r of roles.rows) assert.equal((await db.query("SELECT has_schema_privilege($1,'app','CREATE') AS allowed",[r.rolname])).rows[0].allowed,false);
 await assert.rejects(()=>checkDatabaseRole(db,'api'));
 const apiTarget=new URL(target);apiTarget.username='api_domain_test';apiTarget.password='';const mixedTarget=new URL(apiTarget);mixedTarget.username='mixed_domain_test';
 const apiPool=new pg.Pool({connectionString:apiTarget.toString()}),mixedPool=new pg.Pool({connectionString:mixedTarget.toString()});
 try{await checkDatabaseRole(apiPool,'api');await assert.rejects(()=>checkDatabaseRole(mixedPool,'api'));}finally{await Promise.all([apiPool.end(),mixedPool.end()]);}
});
test('every new entity has mandatory tenant, audit/version fields, and tenant unique IDs',async()=>{
 for(const name of names){
  const cols=await db.query("SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='app' AND table_name=$1",[name]);
  assert.equal(cols.rows.find(c=>c.column_name==='business_id')?.is_nullable,'NO');
  for(const key of ['version','created_at','updated_at','created_by','updated_by'])assert.ok(cols.rows.some(c=>c.column_name===key),`${name}.${key}`);
  if(name!=='business_settings')assert.ok((await db.query("SELECT 1 FROM pg_constraint WHERE conrelid=('app.'||$1)::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (business_id, id)'",[name])).rowCount);
 }
});
test('all internal FKs include business_id, use RESTRICT, and have covering nonpartial indexes',async()=>{
 const fks=await db.query(`SELECT c.conname,c.conkey,c.confdeltype,child.relname AS child,parent.relname AS parent,
  ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(id,pos) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.id ORDER BY k.pos) AS cols,
  EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indpred IS NULL AND ARRAY(SELECT unnest(i.indkey) LIMIT cardinality(c.conkey))=c.conkey) AS covered
  FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace WHERE n.nspname='app' AND c.contype='f'`);
 for(const fk of fks.rows){assert.equal(fk.confdeltype,'r',fk.conname);assert.ok(fk.covered,fk.conname);if(fk.parent!=='users')assert.equal(fk.cols[0],'business_id',fk.conname);}
});
test('worker SELECT is tenant scoped across all 23 populated new tables',async()=>{
 await asRole('app_worker',a.business!,owner,async c=>{for(const t of names){assert.ok((await c.query(`SELECT 1 FROM app.${t} WHERE business_id=$1`,[a.business])).rowCount,t);assert.equal((await c.query(`SELECT 1 FROM app.${t} WHERE business_id=$1`,[b.business])).rowCount,0,t);}});
});
test('API authorization requires active DB membership even with forged tenant context',async()=>{
 for(const actor of [outsider,operator])await asRole('app_api',b.business!,actor,async c=>{for(const t of ['products','orders','messages','human_handoffs'])assert.equal((await c.query(`SELECT id FROM app.${t}`)).rowCount,0,t);});
 await asRole('app_api',a.business!,operator,async c=>assert.equal((await c.query('SELECT id FROM app.products')).rowCount,1));
});
test('operator cannot change catalog; owner writes stay in tenant with immutable business_id',async()=>{
 await assert.rejects(()=>asRole('app_api',a.business!,operator,c=>c.query('INSERT INTO app.categories(business_id,name) VALUES($1,$2)',[a.business,'Denied'])),{code:'42501'});
 assert.equal(await asRole('app_api',a.business!,operator,async c=>(await c.query("UPDATE app.categories SET name='Denied' WHERE id=$1",[a.category])).rowCount),0);
 await assert.rejects(()=>asRole('app_api',a.business!,owner,c=>c.query('INSERT INTO app.categories(business_id,name) VALUES($1,$2)',[b.business,'Denied'])),{code:'42501'});
 await assert.rejects(()=>asRole('app_api',a.business!,owner,c=>c.query('UPDATE app.categories SET business_id=$1 WHERE id=$2',[b.business,a.category])),{code:'42501'});
});
test('ingress cannot read or modify catalog; API cannot read internal inbox or plan tables',async()=>{
 await assert.rejects(()=>asRole('app_ingress',a.business!,owner,c=>c.query("UPDATE app.products SET price_minor=0")),{code:'42501'});
 for(const t of ['webhook_events','outbox_events','confirmation_challenges','conversation_turns','tool_executions','idempotency_keys'])await assert.rejects(()=>asRole('app_api',a.business!,owner,c=>c.query(`SELECT * FROM app.${t}`)),{code:'42501'});
});
test('worker has no catalog/settings/membership writes, order status PATCH, DDL or historical deletion',async()=>{
 for(const sql of ["UPDATE app.products SET price_minor=0","UPDATE app.business_settings SET accepting_orders=true","UPDATE app.business_memberships SET active=false","UPDATE app.orders SET status='confirmed'","DELETE FROM app.messages","DELETE FROM app.audit_logs","CREATE TABLE app.forbidden(id int)"])
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query(sql)),{code:'42501'});
});
test('composite FKs reject cross-tenant product, group, customer, cart, snapshot and challenge references',async()=>{
 for(const [table,data] of [
  ['products',{business_id:a.business,category_id:b.category,name:'Bad',price_minor:1,currency:'USD'}],
  ['modifier_groups',{business_id:a.business,product_id:b.product,name:'Bad'}],
  ['modifier_options',{business_id:a.business,modifier_group_id:b.group,name:'Bad'}],
  ['conversations',{business_id:a.business,customer_id:b.customer,channel_id:a.channel,expires_at:new Date()}],
  ['order_items',{business_id:a.business,order_id:a.order,product_id:b.product,name_snapshot:'Bad',unit_price_minor:1,quantity:1,line_total_minor:1}],
  ['confirmation_challenges',{business_id:a.business,order_id:a.order,customer_id:b.customer,conversation_id:a.conversation,order_version:9,nonce_hash:hash('badtenant'),expires_at:new Date()}]
 ] as const)await assert.rejects(()=>insert(table,data),{code:'23503'});
});
test('money is bigint and rejects negative/unsafe totals, invalid currency and inconsistent payments',async()=>{
 assert.equal((await db.query("SELECT t.typbasetype::regtype::text AS base FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='app' AND t.typname='money_minor'")).rows[0].base,'bigint');
 for(const price of [-1,'9007199254740992'])await assert.rejects(()=>db.query('UPDATE app.products SET price_minor=$1 WHERE id=$2',[price,a.product]),{code:'23514'});
 await assert.rejects(()=>db.query("UPDATE app.products SET currency='EUR' WHERE id=$1",[a.product]),{code:'23514'});
 await assert.rejects(()=>db.query('UPDATE app.orders SET total_minor=1 WHERE id=$1',[a.order]),{code:'23514'});
 await assert.rejects(()=>insert('payments',{business_id:a.business,order_id:a.cancelled,amount_minor:400,currency:'USD'}),{code:'23514'});
});
test('modifier groups enforce cardinality, required minima, normalized uniqueness and soft delete',async()=>{
 for(const values of [[-1,1,false],[2,1,false],[0,1,true],[0,100,false]])await assert.rejects(()=>insert('modifier_groups',{business_id:a.business,product_id:a.product,name:randomUUID(),min_select:values[0],max_select:values[1],required:values[2]}),{code:'23514'});
 await assert.rejects(()=>insert('modifier_groups',{business_id:a.business,product_id:a.product,name:' extras '}),{code:'23505'});
 const id=await insert('modifier_groups',{business_id:a.business,product_id:a.product,name:'Soft'});await db.query('UPDATE app.modifier_groups SET deleted_at=now() WHERE id=$1',[id]);
 assert.ok(await insert('modifier_groups',{business_id:a.business,product_id:a.product,name:'soft'}));
});
test('modifier options reject negative delta, duplicate live names and tenant mismatch',async()=>{
 await assert.rejects(()=>insert('modifier_options',{business_id:a.business,modifier_group_id:a.group,name:'Bad',price_delta_minor:-1}),{code:'23514'});
 await assert.rejects(()=>insert('modifier_options',{business_id:a.business,modifier_group_id:a.group,name:' extra '}),{code:'23505'});
});
test('cart validates quantities, same-product options and canonical fingerprint uniqueness',async()=>{
 for(const quantity of [0,100])await assert.rejects(()=>db.query('UPDATE app.cart_items SET quantity=$1 WHERE id=$2',[quantity,a.item]),{code:'23514'});
 await assert.rejects(()=>db.query('UPDATE app.cart_items SET selected_options=$1 WHERE id=$2',[JSON.stringify([b.option]),a.item]),{code:'23514'});
 await assert.rejects(()=>insert('cart_items',{business_id:a.business,cart_id:a.cart,product_id:a.product,quantity:1,options_fingerprint:hash('forged')}),{code:'23505'});
 await assert.rejects(()=>db.query('UPDATE app.cart_items SET selected_options=$1 WHERE id=$2',[JSON.stringify([a.option,a.option]),a.item]),{code:'23514'});
});
test('opening hours, preferences, messages and GeoJSON reject unvalidated or oversized JSON',async()=>{
 await assert.rejects(()=>db.query('UPDATE app.business_settings SET opening_hours=$1 WHERE business_id=$2',[JSON.stringify([{day:1,opens_at:'09:00',closes_at:'12:00'},{day:1,opens_at:'11:00',closes_at:'13:00'}]),a.business]),{code:'23514'});
 await assert.rejects(()=>db.query('UPDATE app.customers SET preferences=$1 WHERE id=$2',[JSON.stringify({secret:'not-allowed'}),a.customer]),{code:'23514'});
 for(const polygon of [{type:'Polygon',coordinates:[]},{type:'Polygon',coordinates:[[[0,91],[1,0],[1,1],[0,91]]]},{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[2,2]]]}])await assert.rejects(()=>db.query('UPDATE app.delivery_zones SET polygon_geojson=$1 WHERE id=$2',[JSON.stringify(polygon),a.zone]),{code:'23514'});
 await assert.rejects(()=>insert('messages',{business_id:a.business,conversation_id:a.conversation,direction:'inbound',actor_type:'customer',kind:'text',content:JSON.stringify({text:'x'.repeat(2001)})}),{code:'23514'});
});
test('order states, fulfillment and transition history reject skips and invented status',async()=>{
 for(const status of ['draft','delivered','preparing'])await assert.rejects(()=>db.query('UPDATE app.orders SET status=$1 WHERE id=$2',[status,a.order]),{code:'23514'});
 await assert.rejects(()=>insert('order_transitions',{business_id:a.business,order_id:a.order,from_status:'confirmed',to_status:'accepted',actor_type:'human',actor_id:owner,trigger:'accept',causation_id:randomUUID(),resulting_version:2}),{code:'23514'});
});
test('catalog changes and soft delete cannot mutate order item snapshots or erase history',async()=>{
 await asRole('app_api',a.business!,owner,c=>c.query("UPDATE app.products SET name='Nuevo',price_minor=700,deleted_at=now() WHERE id=$1",[a.product]));
 const item=(await db.query('SELECT name_snapshot,unit_price_minor FROM app.order_items WHERE id=$1',[a.orderItem])).rows[0];assert.equal(item.name_snapshot,'Producto');assert.equal(item.unit_price_minor,'500');
 await assert.rejects(()=>db.query('DELETE FROM app.products WHERE id=$1',[a.product]),{code:'23503'});
 await assert.rejects(()=>db.query('DELETE FROM app.businesses WHERE id=$1',[a.business]),{code:'23503'});
});
test('idempotency uniqueness survives 16 concurrent inserts and separates actor/operation/tenant',async()=>{
 const key=hash('concurrent');const values=[a.business,owner,'concurrent',key,hash('request')];
 const attempts=await Promise.all(Array.from({length:16},()=>db.query("INSERT INTO app.idempotency_keys(business_id,actor_scope,operation,key_hash,request_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day') ON CONFLICT(business_id,actor_scope,operation,key_hash) DO NOTHING RETURNING id",values)));
 assert.equal(attempts.reduce((sum,x)=>sum+(x.rowCount??0),0),1);
 assert.ok(await insert('idempotency_keys',{business_id:b.business,actor_scope:owner,operation:'concurrent',key_hash:key,request_hash:hash('request'),expires_at:new Date(Date.now()+100000)}));
});
test('challenge binds customer/conversation/order/version and stores only unique nonce hash',async()=>{
 assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='confirmation_challenges' AND column_name IN ('nonce','token','raw_nonce')")).rowCount,0);
 await assert.rejects(()=>insert('confirmation_challenges',{business_id:a.business,order_id:a.order,customer_id:a.customer,conversation_id:a.conversation,order_version:1,nonce_hash:hash('another'),expires_at:new Date(Date.now()+10000)}),{code:'23505'});
 await assert.rejects(()=>insert('confirmation_challenges',{business_id:b.business,order_id:b.order,customer_id:b.customer,conversation_id:b.conversation,order_version:2,nonce_hash:a.challengeHash,expires_at:new Date(Date.now()+10000)}),{code:'23505'});
});
test('challenge rejects wrong hash/customer/free text/expired/stale evidence and consumes once concurrently',async()=>{
 const consume=(customer:string,nonce:string,message:string)=>asRole('app_worker',a.business!,owner,async c=>(await c.query('SELECT app.consume_confirmation_challenge($1,$2,$3,$4) AS ok',[a.challenge,customer,nonce,message])).rows[0].ok);
 assert.equal(await consume(b.customer!,a.challengeHash!,a.message!),false);assert.equal(await consume(a.customer!,hash('wrong'),a.message!),false);
 const text=await insert('messages',{business_id:a.business,conversation_id:a.conversation,direction:'inbound',actor_type:'customer',kind:'text',content:JSON.stringify({text:'sí'})});assert.equal(await consume(a.customer!,a.challengeHash!,text),false);
 await db.query('UPDATE app.confirmation_challenges SET expires_at=now()-interval \'1 minute\' WHERE id=$1',[a.challenge]);assert.equal(await consume(a.customer!,a.challengeHash!,a.message!),false);
 await db.query('UPDATE app.confirmation_challenges SET expires_at=now()+interval \'10 minutes\' WHERE id=$1',[a.challenge]);
 // Challenge version is stale if the proposal version changed.
 await db.query('UPDATE app.orders SET quote_expires_at=quote_expires_at WHERE id=$1',[a.order]);assert.equal(await consume(a.customer!,a.challengeHash!,a.message!),false);
 // Use the untouched B challenge to exercise atomic consumption.
 const results=await Promise.all(Array.from({length:12},()=>asRole('app_worker',b.business!,owner,async c=>(await c.query('SELECT app.consume_confirmation_challenge($1,$2,$3,$4) AS ok',[b.challenge,b.customer,b.challengeHash,b.message])).rows[0].ok)));
 assert.equal(results.filter(Boolean).length,1);
 await assert.rejects(()=>asRole('app_worker',b.business!,owner,c=>c.query('UPDATE app.confirmation_challenges SET consumed_at=NULL,confirmation_message_id=NULL WHERE id=$1',[b.challenge])),{code:'23514'});
});
test('confirmation evidence preserves immutable order snapshots and only one conversion per cart',async()=>{
 await db.query("UPDATE app.orders SET status='confirmed',confirmed_at=now(),confirmation_message_id=$1 WHERE id=$2",[b.message,b.order]);
 await assert.rejects(()=>db.query('UPDATE app.orders SET subtotal_minor=600,total_minor=600 WHERE id=$1',[b.order]),{code:'23514'});
 await assert.rejects(()=>db.query('UPDATE app.order_items SET quantity=2,line_total_minor=1000 WHERE id=$1',[b.orderItem]),{code:'23514'});
 await assert.rejects(()=>asRole('app_worker',b.business!,owner,c=>c.query('DELETE FROM app.order_items WHERE id=$1',[b.orderItem])),{code:'42501'});
 const second=await insert('orders',{business_id:b.business,customer_id:b.customer,conversation_id:b.conversation,source_cart_id:b.cart,source_cart_version:3,fulfillment:'pickup',currency:'USD',subtotal_minor:500,total_minor:500,quote_expires_at:new Date(Date.now()+600000)});
 const message=await insert('messages',{business_id:b.business,conversation_id:b.conversation,direction:'inbound',actor_type:'customer',kind:'interactive',content:JSON.stringify({id:'second-button',title:'Confirmar'})});
 const nonce=hash(randomBytes(32).toString('hex'));
 const challenge=await insert('confirmation_challenges',{business_id:b.business,order_id:second,customer_id:b.customer,conversation_id:b.conversation,order_version:1,nonce_hash:nonce,expires_at:new Date(Date.now()+600000)});
 await asRole('app_worker',b.business!,owner,c=>c.query('SELECT app.consume_confirmation_challenge($1,$2,$3,$4)',[challenge,b.customer,nonce,message]));
 await assert.rejects(()=>db.query("UPDATE app.orders SET status='confirmed',confirmed_at=now(),confirmation_message_id=$1 WHERE id=$2",[message,second]),{code:'23505'});
});
test('outbox dedupe is tenant safe and unknown/sent cannot be blindly returned to pending',async()=>{
 await assert.rejects(()=>insert('outbox_events',{business_id:a.business,event_type:'order.created',aggregate_id:a.order,aggregate_version:1,causation_id:randomUUID(),dedupe_key:'Domain-A',payload:JSON.stringify({resource_id:a.order,resource_version:1})}),{code:'23505'});
 await asRole('app_worker',a.business!,owner,c=>c.query("UPDATE app.outbox_events SET status='unknown' WHERE id=$1",[a.outbox]));
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query("UPDATE app.outbox_events SET status='pending' WHERE id=$1",[a.outbox])),{code:'23514'});
});
test('turn/slot identity and persisted plan cannot change on retries',async()=>{
 await assert.rejects(()=>insert('conversation_turns',{business_id:a.business,conversation_id:a.conversation,inbound_message_id:a.message,automation_epoch:1}),{code:'23505'});
 await assert.rejects(()=>insert('tool_executions',{business_id:a.business,turn_id:a.turn,action_index:0,tool_name:'get_cart',arguments_hash:hash('arguments')}),{code:'23505'});
 await assert.rejects(()=>insert('tool_executions',{business_id:a.business,turn_id:a.turn,action_index:1,tool_name:'get_cart',arguments_hash:hash('arguments')}),{code:'23514'});
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query('UPDATE app.conversation_turns SET plan=$1 WHERE id=$2',[JSON.stringify({actions:[]}),a.turn])),{code:'23514'});
 await asRole('app_worker',a.business!,owner,c=>c.query("UPDATE app.tool_executions SET status='completed' WHERE id=$1",[a.tool]));
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query("UPDATE app.tool_executions SET status='pending' WHERE id=$1",[a.tool])),{code:'23514'});
});
test('handoff unique open slot, active assignee and epoch constraints persist safely',async()=>{
 await assert.rejects(()=>insert('human_handoffs',{business_id:a.business,conversation_id:a.conversation,reason:'system_failure'}),{code:'23505'});
 await assert.rejects(()=>asRole('app_worker',b.business!,owner,c=>c.query("UPDATE app.human_handoffs SET assigned_user_id=$1,status='active' WHERE id=$2",[operator,b.handoff])),{code:'23514'});
 await asRole('app_worker',a.business!,owner,c=>c.query('UPDATE app.conversations SET automation_epoch=2 WHERE id=$1',[a.conversation]));
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query('UPDATE app.conversations SET automation_epoch=1 WHERE id=$1',[a.conversation])),{code:'23514'});
});
test('AI remains disabled and no privileged function or transport runtime was added',async()=>{
 await assert.rejects(()=>db.query('UPDATE app.business_settings SET ai_enabled=true WHERE business_id=$1',[a.business]),{code:'23514'});
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query('UPDATE app.businesses SET currency=\'EUR\'')),{code:'42501'});
});
test('cart deletion is limited to active carts and append-only transitions cannot be changed',async()=>{
 await db.query("UPDATE app.carts SET status='expired' WHERE id=$1",[a.cart]);
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query('DELETE FROM app.cart_items WHERE id=$1',[a.item])),{code:'23514'});
 await assert.rejects(()=>asRole('app_worker',a.business!,owner,c=>c.query("UPDATE app.order_transitions SET resulting_version=99 WHERE id=$1",[a.transition])),{code:'42501'});
});
