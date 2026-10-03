import { createHmac } from 'node:crypto';
import type { Config } from '../src/config/env.js';
import { buildApp, type AppDependencies } from '../src/bootstrap/app.js';
import { unauthenticated } from '../src/platform/errors.js';

export const userA = '11111111-1111-4111-8111-111111111111';
export const userB = '22222222-2222-4222-8222-222222222222';
export const businessA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const businessB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const config: Config = {
  environment:'test', port:3000, databaseUrl:'postgres://api_test@127.0.0.1/agente_ia_test',
  webhookDatabaseUrl:'postgres://ingress_test@127.0.0.1/agente_ia_test', supabaseUrl:'https://synthetic-project.supabase.co',
  whatsappVerifyToken:'synthetic-verify-token-only',whatsappAppSecret:'synthetic-app-secret-only',adminAllowedOrigins:['http://localhost:5173']
};
export const signature = (raw: string | Buffer) => 'sha256=' + createHmac('sha256',config.whatsappAppSecret).update(raw).digest('hex');
export function envelope(messages: unknown[] = [], statuses: unknown[] = [], phone = 'channel-a') {
  return { object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phone},messages,statuses}}]}] };
}
export function textMessage(id = 'wamid.synthetic-a', text = 'Hola') {
  return { id,from:'synthetic-customer',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text} };
}
export async function testApp(overrides: Partial<AppDependencies> = {}) {
  return buildApp({
    config,logger:false,readiness:async () => {},
    auth:{verify:async token => { if (token !== 'synthetic.valid.token') throw unauthenticated(); return {userId:userA}; }},
    identities:{getMe:async userId => ({user_id:userId,memberships:[]}),getBusiness:async () => null},
    inbox:{ingest:async events => ({inserted:events.length,duplicates:0,unknownChannels:[]})},
    ...overrides
  });
}
