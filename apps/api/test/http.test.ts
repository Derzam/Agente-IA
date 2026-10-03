import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { config, envelope, signature, testApp, textMessage, userA, businessA } from './helpers.js';

test('GET verification returns literal challenge only with correct token', async t => {
  const app=await testApp(); t.after(()=>app.close());
  const res=await app.inject({url:`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${config.whatsappVerifyToken}&hub.challenge=007%2B%3Ctest%3E`});
  assert.equal(res.statusCode,200); assert.equal(res.body,'007+<test>'); assert.match(res.headers['content-type']!,/text\/plain/);
});
test('verification rejects incorrect token, missing and duplicate params without leaking token',async t=>{
  const app=await testApp();t.after(()=>app.close());
  const wrong=await app.inject('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1');
  assert.equal(wrong.statusCode,403);assert.ok(!wrong.body.includes(config.whatsappVerifyToken));
  assert.equal((await app.inject('/webhooks/whatsapp?hub.mode=subscribe')).statusCode,400);
  assert.equal((await app.inject('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=a&hub.verify_token=b&hub.challenge=1')).statusCode,400);
});
test('POST checks HMAC on original whitespace/UTF8 bytes and commits before ACK',async t=>{
  let calls=0; let release:()=>void=()=>{};
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  const app=await testApp({inbox:{ingest:async()=>{calls++;await barrier;return{inserted:1,duplicates:0,unknownChannels:[]};}}});t.after(()=>app.close());
  const raw=JSON.stringify(envelope([textMessage('wamid.utf8','menú 🍲')]),null,2)+'\n';
  let finished=false;
  const pending=app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)},payload:raw}).then(r=>{finished=true;return r;});
  for(let i=0;i<30 && !calls;i++) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,1);assert.equal(finished,false);release();
  assert.equal((await pending).statusCode,200);
});
test('invalid/missing/altered signatures fail before parsing or persistence',async t=>{
  let calls=0;const app=await testApp({inbox:{ingest:async()=>{calls++;return{inserted:0,duplicates:0,unknownChannels:[]};}}});t.after(()=>app.close());
  const raw=JSON.stringify(envelope([textMessage()]));
  for(const sig of [undefined,'sha256=invalid','sha256='+'0'.repeat(64),signature(raw+' ')]){
    const res=await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json',...(sig?{'x-hub-signature-256':sig}:{})},payload:raw});
    assert.equal(res.statusCode,401);
  }
  assert.equal(calls,0);
});
test('signed malformed JSON/invalid envelope returns 400 without DB effect',async t=>{
  let calls=0;const app=await testApp({inbox:{ingest:async()=>{calls++;return{inserted:0,duplicates:0,unknownChannels:[]};}}});t.after(()=>app.close());
  for(const raw of ['{"broken":',JSON.stringify({entry:'wrong'})]){
    assert.equal((await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)},payload:raw})).statusCode,400);
  }
  assert.equal(calls,0);
});
test('oversize payload returns 413 before persistence',async t=>{
  const app=await testApp({inbox:{ingest:async()=>{throw new Error('must not run');}}});t.after(()=>app.close());
  const raw=' '.repeat(1024*1024+1);
  const res=await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)},payload:raw});
  assert.equal(res.statusCode,413);assert.equal(res.json().error.code,'VALIDATION_ERROR');
});
test('DB error yields retryable 503 with no stack/connection details',async t=>{
  const app=await testApp({inbox:{ingest:async()=>{throw new Error('private-db-host password=hidden');}}});t.after(()=>app.close());
  const raw=JSON.stringify(envelope([textMessage()]));
  const res=await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)},payload:raw});
  assert.equal(res.statusCode,503);assert.equal(res.json().error.retryable,true);assert.ok(res.headers['retry-after']);assert.ok(!res.body.includes('private-db-host'));
});
test('health lives independently of DB and readiness fails safely',async t=>{
  const app=await testApp({readiness:async()=>{throw new Error('private');}});t.after(()=>app.close());
  assert.equal((await app.inject('/health')).statusCode,200);
  assert.equal((await app.inject('/ready')).statusCode,503);
});
test('readiness success and every request gets server generated UUID',async t=>{
  const app=await testApp();t.after(()=>app.close());
  const res=await app.inject({url:'/ready',headers:{'x-request-id':'untrusted'}});
  assert.equal(res.statusCode,200);assert.match(String(res.headers['x-request-id']),/^[0-9a-f-]{36}$/);
  const missing=await app.inject('/missing');assert.equal(missing.statusCode,404);assert.equal(missing.json().meta.request_id,missing.headers['x-request-id']);
});
test('me uses verified identity and ignores fabricated membership headers/query',async t=>{
  const app=await testApp();t.after(()=>app.close());
  const res=await app.inject({url:`/v1/me?business_id=${businessA}&role=owner`,headers:{authorization:'Bearer synthetic.valid.token','x-user-id':'fake','x-business-id':businessA}});
  assert.equal(res.statusCode,200);assert.deepEqual(res.json().data,{user_id:userA,memberships:[]});
  assert.equal((await app.inject('/v1/me')).statusCode,401);
  assert.equal((await app.inject({url:'/v1/me',headers:{authorization:'Bearer invalid'}})).statusCode,401);
});
test('CORS exact allowlist, secure headers and basic rate limiting',async t=>{
  const app=await testApp({rateLimitMax:2});t.after(()=>app.close());
  const good=await app.inject({url:'/v1/me',headers:{origin:'http://localhost:5173'}});
  assert.equal(good.headers['access-control-allow-origin'],'http://localhost:5173');assert.equal(good.headers['x-content-type-options'],'nosniff');
  const bad=await app.inject({url:'/v1/me',headers:{origin:'https://evil.example'}});assert.equal(bad.headers['access-control-allow-origin'],undefined);
  const limited=await app.inject('/v1/me');assert.equal(limited.statusCode,429);assert.equal(limited.json().error.code,'RATE_LIMITED');
});
test('structured logging omits query, bearer, payload and injected PII',async t=>{
  let output='';const stream=new Writable({write(chunk,_enc,done){output+=chunk.toString();done();}});
  const app=await testApp({logger:{level:'info',stream}});t.after(()=>app.close());
  await app.inject(`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${config.whatsappVerifyToken}&hub.challenge=1`);
  const raw=JSON.stringify(envelope([textMessage('wamid.log','sensitive-address-for-test')]));
  await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw),authorization:'Bearer sensitive-log-marker'},payload:raw});
  for(const secret of [config.whatsappVerifyToken,config.whatsappAppSecret,'sensitive-address-for-test','sensitive-log-marker','synthetic-customer'])assert.ok(!output.includes(secret));
  const lines=output.trim().split('\n').map(line=>JSON.parse(line));assert.ok(lines.some(line=>line.request_id&&line.route&&line.status_code&&typeof line.duration_ms==='number'));
});
