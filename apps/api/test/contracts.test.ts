import test from 'node:test';
import assert from 'node:assert/strict';
import { config, testApp } from './helpers.js';
import { contract as document, assertContract as matches, assertSchema, compileAllSchemas } from './schema.js';

test('all canonical schemas compile under strict JSON Schema 2020-12',()=>{compileAllSchemas();});
test('me and standard errors conform to canonical OpenAPI closed schemas',async t=>{
  const app=await testApp();t.after(()=>app.close());
  const me=await app.inject({url:'/v1/me',headers:{authorization:'Bearer synthetic.valid.token'}});
  matches('MeResponse',me.json());
  for(const path of ['/v1/me','/not-implemented'])matches('ApiError',(await app.inject(path)).json());
});
test('webhook GET literal challenge conforms to documented text response',async t=>{
  const app=await testApp();t.after(()=>app.close());
  const res=await app.inject(`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${config.whatsappVerifyToken}&hub.challenge=canonical`);
  assert.equal(res.statusCode,200);assertSchema(document.paths['/webhooks/whatsapp'].get.responses['200'].content['text/plain'].schema,res.body);
});
test('implemented health/readiness success schemas agree with OpenAPI',async t=>{
  const app=await testApp();t.after(()=>app.close());
  for(const path of ['/health','/ready']){
    const res=await app.inject(path);assert.equal(res.statusCode,200);assertSchema(document.paths[path].get.responses['200'].content['application/json'].schema,res.json());
  }
});
