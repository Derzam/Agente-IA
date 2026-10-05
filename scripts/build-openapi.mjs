// Single source for published and runtime HTTP validation contracts; no provider calls.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const target = fileURLToPath(new URL('../docs/api/openapi.json', import.meta.url));
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const str = (maxLength = 120) => ({ type: 'string', maxLength });
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date-time' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const version = { type: 'integer', minimum: 1, maximum: 2147483647 };
const bool = { type: 'boolean' };
const money = integer;
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const arr = (items, maxItems = 100) => ({ type: 'array', items, maxItems });
const en = values => ({ type: 'string', enum: values.split(' ') });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const entity = { id: uuid, business_id: uuid, created_at: date, updated_at: date, version };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const qty = { type: 'integer', minimum: 1, maximum: 99 };
const text = str(2000);
const lat = nullable({ type: 'number', minimum: -90, maximum: 90 });
const lon = nullable({ type: 'number', minimum: -180, maximum: 180 });
const S = {};
S.Role = en('owner manager operator');
S.OrderStatus = en('awaiting_confirmation confirmed accepted preparing ready out_for_delivery delivered cancelled');
S.OrderAction = en('accept start_preparation mark_ready dispatch complete cancel');
S.ConversationStatus = en('bot_active human_pending human_active closed');
S.HandoffReason = en('explicit_request misunderstanding complaint payment_issue system_failure');
S.ErrorCode = en('VALIDATION_ERROR UNAUTHENTICATED FORBIDDEN NOT_FOUND VERSION_CONFLICT IDEMPOTENCY_CONFLICT REQUEST_IN_PROGRESS INVALID_ORDER_TRANSITION QUOTE_CHANGED QUOTE_EXPIRED PRODUCT_UNAVAILABLE DELIVERY_UNAVAILABLE BUSINESS_CLOSED HANDOFF_REQUIRED WINDOW_CLOSED RATE_LIMITED PROVIDER_UNAVAILABLE INTERNAL_ERROR');
S.Meta = object({ request_id: uuid });
S.Pagination = object({ next_cursor: nullable(str(2048)), has_more: bool, limit: { type: 'integer', minimum: 1, maximum: 100 } });
S.ApiError = object({ error: object({ code: ref('ErrorCode'), message: str(500), details: arr(object({ field: str(120), issue: str(200) }), 20), retryable: bool }), meta: ref('Meta') });
S.Business = object({ ...entity, name: str(), slug: str(), currency, timezone: str(), status: en('active suspended') });
const categoryInput = { name: { ...str(), minLength: 1 }, sort_order: integer, active: bool };
S.Category = object({ ...entity, ...categoryInput });
const optionInput = { group_key: str(), name: { ...str(), minLength: 1 }, price_delta_minor: money, required: bool, min_select: integer, max_select: integer, available: bool };
S.ProductOption = object({ ...entity, product_id: uuid, ...optionInput });
const productInput = { category_id: uuid, name: { ...str(), minLength: 1 }, description: nullable(text), price_minor: money, currency, available: bool, image_url: nullable({ type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 }) };
const groupInput={name:{...str(),minLength:1},required:bool,min_select:{...integer,maximum:99},max_select:{...integer,maximum:99},sort_order:{...integer,maximum:100000},active:bool};
const modifierInput={name:{...str(),minLength:1},price_delta_minor:money,available:bool,sort_order:{...integer,maximum:100000}};
S.ModifierGroup=object({...entity,product_id:uuid,...groupInput});
S.ModifierOption=object({...entity,modifier_group_id:uuid,...modifierInput});
S.Product=object({...entity,...productInput,options:arr(ref('ProductOption'),100),modifier_groups:arr(object({...S.ModifierGroup.properties,options:arr(ref('ModifierOption'),99)}),99)},[...Object.keys(entity),...Object.keys(productInput),'options']);
S.Customer = object({ ...entity, display_name: nullable(str()), phone_masked: nullable(str(30)) });
const address = { address_text: str(1000), latitude: lat, longitude: lon, instructions: nullable(str(1000)) };
S.AddressSnapshot = object(address);
S.Address = object({ ...entity, customer_id: uuid, ...address });
S.CartItem = object({ id: uuid, product_id: uuid, option_ids: arr(uuid, 20), quantity: qty, notes: nullable(str(1000)), unit_price_minor: money, line_total_minor: money });
S.Cart = object({ ...entity, customer_id: uuid, conversation_id: uuid, status: en('active converted expired'), items: arr(ref('CartItem'), 50), subtotal_minor: money, currency, expires_at: date });
S.OptionSnapshot = object({ name: str(), price_delta_minor: money });
S.OrderItem = object({ id: uuid, product_id: nullable(uuid), name_snapshot: str(), option_snapshots: arr(ref('OptionSnapshot'), 20), quantity: qty, unit_price_minor: money, line_total_minor: money, notes: nullable(str(1000)) });
S.Order = object({ ...entity, customer_id: uuid, conversation_id: uuid, status: ref('OrderStatus'), fulfillment: en('pickup delivery'), items: arr(ref('OrderItem'), 50), subtotal_minor: money, tax_minor: money, delivery_minor: money, discount_minor: money, total_minor: money, currency, address_snapshot: nullable(ref('AddressSnapshot')), quote_expires_at: date, confirmed_at: nullable(date), cancellation_reason: nullable(str(1000)) });
S.Payment = object({ ...entity, order_id: uuid, method: en('cash_on_delivery'), status: en('pending paid cancelled'), amount_minor: money, currency, paid_at: nullable(date) });
S.Conversation = object({ ...entity, customer_id: uuid, status: ref('ConversationStatus'), assigned_user_id: nullable(uuid), last_customer_message_at: nullable(date), expires_at: date, automation_epoch: integer });
S.Message = object({ ...entity, conversation_id: uuid, direction: en('inbound outbound'), kind: en('text interactive location unsupported'), actor_type: en('customer bot human system'), outbox_id: nullable(uuid), text: nullable(text), delivery_status: nullable(en('pending sent delivered read failed unknown')) });
S.HumanHandoff = object({ ...entity, conversation_id: uuid, reason: ref('HandoffReason'), status: en('pending active resolved'), assigned_user_id: nullable(uuid), resolved_at: nullable(date), resolution: nullable(str(1000)) });
S.OpeningInterval = object({ day: { type: 'integer', minimum: 0, maximum: 6, description: '0 domingo; intervalos mismo día, dividir cruces de medianoche.' }, opens_at: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }, closes_at: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' } });
const settingsInput = { opening_hours: arr(ref('OpeningInterval'), 28), accepting_orders: bool, delivery_enabled: bool, pickup_enabled: bool, min_order_minor: money, session_ttl_minutes: { type: 'integer', minimum: 15, maximum: 1440 }, ai_enabled: bool };
S.TaxPolicy=object({mode:en('none exclusive'),rate_bps:{...integer,maximum:10000},rounding:en('per_line_half_up')});
settingsInput.tax_policy=nullable(ref('TaxPolicy'));
S.BusinessSettings=object({business_id:uuid,version,created_at:date,updated_at:date,...settingsInput},['business_id','version','created_at','updated_at',...Object.keys(settingsInput).filter(k=>k!=='tax_policy')]);
const polygon = object({ type: en('Polygon'), coordinates: arr({ type: 'array', minItems: 4, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }, 20) });
const zoneInput = { name: str(), polygon_geojson: polygon, fee_minor: money, min_order_minor: money, priority: integer, active: bool };
S.DeliveryZone = object({ ...entity, ...zoneInput });
S.Metrics = object({ from: date, to: date, orders_confirmed: integer, orders_cancelled: integer, handoffs_created: integer, sales_minor: money, currency, generated_at: date });
S.Membership = object({ business_id: uuid, role: ref('Role') });
S.Me = object({ user_id: uuid, memberships: arr(ref('Membership')) });
S.Money = object({ amount_minor: money, currency });
for (const [name, props] of Object.entries({ ModifierGroupInput: groupInput, ModifierOptionInput: modifierInput, CategoryInput: categoryInput, ProductInput: productInput, ProductOptionInput: optionInput, DeliveryZoneInput: zoneInput })) {
  S[name] = object(props);
  S[name.replace('Input', 'Update')] = { ...object({ ...props, expected_version: version }, ['expected_version']), minProperties: 2 };
}
S.BusinessUpdate = { ...object({ name: str(), timezone: str(), expected_version: version }, ['expected_version']), minProperties: 2 };
S.SettingsUpdate = { ...object({ ...settingsInput, expected_version: version }, ['expected_version']), minProperties: 2 };
S.OrderTransitionInput = object({ action: ref('OrderAction'), reason: nullable(str(1000)), expected_version: version });
S.HandoffCreateInput = object({ reason: ref('HandoffReason'), context: nullable(str(1000)), expected_conversation_version: version });
S.HandoffClaimInput = object({ assigned_user_id: uuid, expected_version: version });
S.HandoffResolveInput = object({ action: en('resume_bot close'), resolution: { ...str(1000), minLength: 1 }, expected_version: version });
S.HumanMessageInput = object({ text: { ...str(2000), minLength: 1 }, expected_conversation_version: version });
S.MessageReceipt = object({ outbox_id: uuid, status: en('queued') });
S.PaymentRecordInput = object({ paid_at: date, note: { ...str(1000), minLength: 1 }, expected_version: version });
S.DomainEventType = en('order.created order.status_changed conversation.updated message.received message.delivery_updated handoff.created handoff.resolved');
S.DomainEvent = object({ event_id: uuid, business_id: uuid, type: ref('DomainEventType'), resource_id: uuid, resource_version: version, occurred_at: date, request_id: uuid });
for (const name of ['ModifierGroup','ModifierOption','Business','Category','Product','ProductOption','Customer','Order','Payment','Conversation','Message','HumanHandoff','BusinessSettings','DeliveryZone','Metrics','Me','MessageReceipt']) {
  S[`${name}Response`] = object({ data: ref(name), meta: ref('Meta') });
  S[`${name}Page`] = object({ data: arr(ref(name)), meta: ref('Meta'), pagination: ref('Pagination') });
}
const parameter = (name, location, schema, required = false) => ({ name, in: location, required, schema });
const content = schema => ({ 'application/json': { schema } });
const response = schema => ({ description: 'Resultado propuesto; ver reglas del dominio.', content: content(schema) });
const errorResponses = Object.fromEntries(['400','401','403','404','409','422','429','500','503'].map(status => [`Error${status}`, {
  description: 'Error normalizado; códigos y condiciones en docs/api/contracts.md.',
  content: content(ref('ApiError')),
  ...(['409','429','503'].includes(status) ? { headers: { 'Retry-After': { description:'Segundos de espera cuando error.retryable=true; no repetir una acción con versión nueva sin decisión.', schema:integer } } } : {})
}]));
const paths = {};
const base = '/v1/businesses/{business_id}';
let count = 0;
function operation(method, suffix, summary, schema, options = {}) {
  const path = options.absolute ? suffix : base + suffix;
  const mutating = method !== 'get';
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(match => parameter(match[1], 'path', uuid, true));
  if (mutating) parameters.push(parameter('Idempotency-Key', 'header', uuid, true));
  if (options.page) parameters.push(parameter('cursor','query',str(2048)), parameter('limit','query',{ type:'integer', minimum:1, maximum:100, default:20 }));
  if (method === 'delete') parameters.push(parameter('expected_version','query',version,true));
  for (const [name, s] of Object.entries(options.filters || {})) parameters.push(parameter(name,'query',s,options.requiredFilters || false));
  const responses = {};
  const code = options.code || (method === 'delete' ? '204' : method === 'post' ? '201' : '200');
  responses[code] = method === 'delete' ? { description:'Soft delete realizado, sin cuerpo.' } : response(ref(schema));
  if (options.also200) responses['200'] = response(ref(schema));
  for (const status of ['400','401','403','404','409','422','429','500','503']) responses[status] = { $ref: `#/components/responses/Error${status}` };
  count++;
  const paginationDescription = options.page ? (suffix === '/categories' ? ' Lista ordenada sort_order ASC,id ASC; cursor ligado al orden y tenant.' : ' Lista ordenada created_at DESC,id DESC; cursor ligado a filtros y tenant.') : '';
  const op = { operationId: `${method}_${path.replace(/[{}]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_/, '')}`, summary, description: 'PROPUESTA NO IMPLEMENTADA. Autorización y validación de negocio adicionales en docs/api/contracts.md.' + paginationDescription, tags: [options.tag || suffix.split('/')[1] || 'business'], security: [{ supabaseBearer: [] }], 'x-roles': options.roles || ['owner','manager','operator'], parameters, responses };
  op['x-implementation-status']='IMPLEMENTED';
  if (op['x-implementation-status'] === 'IMPLEMENTED') op.description = 'IMPLEMENTED en fase 4; sin despliegue público. Autorización y validación en docs/api/contracts.md.' + paginationDescription;
  if (options.body) op.requestBody = { required:true, content:content(ref(options.body)) };
  if (mutating) responses[code].headers = { 'Idempotency-Replayed': { description:'true si se devolvió resultado persistido de mismo actor/comando.', schema:bool } };
  (paths[path] ||= {})[method] = op;
}
const management = ['owner','manager'];
operation('get','/v1/me','Identidad y negocios autorizados','MeResponse',{absolute:true,roles:['authenticated'],tag:'auth'});
operation('get','','Consultar negocio','BusinessResponse');
operation('patch','','Actualizar negocio','BusinessResponse',{body:'BusinessUpdate',roles:management});
operation('get','/settings','Consultar configuración','BusinessSettingsResponse');
operation('patch','/settings','Actualizar configuración','BusinessSettingsResponse',{body:'SettingsUpdate',roles:management});
function crud(collection, name, id, readFilters = {}, canRead = ['owner','manager','operator']) {
  operation('get',`/${collection}`,`Listar ${collection}`,`${name}Page`,{page:true,filters:readFilters,roles:canRead});
  operation('post',`/${collection}`,`Crear ${name}`,`${name}Response`,{body:`${name}Input`,roles:management});
  operation('patch',`/${collection}/{${id}}`,`Editar ${name}`,`${name}Response`,{body:`${name}Update`,roles:management});
  operation('delete',`/${collection}/{${id}}`,`Eliminar lógicamente ${name}`,null,{roles:management});
}
crud('categories','Category','category_id');
crud('products','Product','product_id',{category_id:uuid,available:bool});
operation('get','/products/{product_id}','Detalle de producto','ProductResponse');
operation('post','/products/{product_id}/options','Crear opción','ProductOptionResponse',{body:'ProductOptionInput',roles:management});
operation('patch','/products/{product_id}/options/{option_id}','Actualizar opción','ProductOptionResponse',{body:'ProductOptionUpdate',roles:management});
operation('delete','/products/{product_id}/options/{option_id}','Eliminar opción',null,{roles:management});
crud('products/{product_id}/modifier-groups','ModifierGroup','group_id');
crud('products/{product_id}/modifier-groups/{group_id}/options','ModifierOption','option_id');
for(const path of Object.keys(paths).filter(p=>p.includes('/products/')&&p.includes('/options'))){for(const op of Object.values(paths[path]))if(!path.includes('/modifier-groups/'))op.deprecated=true;}
crud('delivery-zones','DeliveryZone','zone_id',{},management);
operation('get','/orders','Listar pedidos','OrderPage',{page:true,filters:{status:ref('OrderStatus'),customer_id:uuid}});
operation('get','/orders/{order_id}','Detalle pedido','OrderResponse');
operation('post','/orders/{order_id}/transitions','Transición según máquina de estados','OrderResponse',{body:'OrderTransitionInput',code:'200'});
operation('get','/orders/{order_id}/payments','Pagos registrados','PaymentPage',{page:true});
operation('post','/orders/{order_id}/payments/cash-record','Registro manual de efectivo; no cobra','PaymentResponse',{body:'PaymentRecordInput',roles:management,code:'200'});
operation('get','/customers','Listar clientes enmascarados','CustomerPage',{page:true});
operation('get','/customers/{customer_id}','Detalle cliente mínimo','CustomerResponse');
operation('get','/conversations','Listar conversaciones','ConversationPage',{page:true,filters:{status:ref('ConversationStatus')}});
operation('get','/conversations/{conversation_id}','Detalle conversación','ConversationResponse');
operation('get','/conversations/{conversation_id}/messages','Historial paginado','MessagePage',{page:true});
operation('post','/conversations/{conversation_id}/messages','Mensaje humano solo en conversación asignada activa','MessageReceiptResponse',{body:'HumanMessageInput',code:'202'});
operation('get','/handoffs','Listar handoffs','HumanHandoffPage',{page:true,filters:{status:en('pending active resolved')}});
operation('post','/conversations/{conversation_id}/handoffs','Pausar bot y solicitar humano','HumanHandoffResponse',{body:'HandoffCreateInput',also200:true});
operation('post','/handoffs/{handoff_id}/claim','Asignar handoff; operador solo a sí mismo','HumanHandoffResponse',{body:'HandoffClaimInput',code:'200'});
operation('post','/handoffs/{handoff_id}/resolve','Resolver y devolver control o cerrar','HumanHandoffResponse',{body:'HandoffResolveInput',code:'200'});
operation('get','/metrics','Métricas agregadas rango máximo 31 días','MetricsResponse',{roles:management,filters:{from:date,to:date},requiredFilters:true});
paths['/webhooks/whatsapp'] = {
  get: { operationId:'verifyWhatsAppWebhook',summary:'PROPUESTA: handshake Meta',security:[],parameters:[parameter('hub.mode','query',en('subscribe'),true),parameter('hub.verify_token','query',str(512),true),parameter('hub.challenge','query',str(512),true)],responses:{200:{description:'Challenge literal',content:{'text/plain':{schema:str(512)}}},400:{description:'Query incompleta'},403:{description:'Token de verificación incorrecto'}} },
  post: { operationId:'receiveWhatsAppWebhook',summary:'PROPUESTA: inbox firmado; ACK después de commit',security:[],parameters:[parameter('X-Hub-Signature-256','header',{type:'string',pattern:'^sha256=[a-fA-F0-9]{64}$'},true)],requestBody:{required:true,description:'Payload externo Meta: validar esquema de proveedor en adapter, no DTO de panel; raw body <=1MiB.',content:content({type:'object',additionalProperties:true})},responses:{200:{description:'Persistido o duplicado'},400:{description:'JSON inválido'},401:{description:'Firma inválida'},413:{description:'Payload supera 1MiB'},503:{description:'No se pudo persistir; Meta debe reintentar'}} }
};
for (const op of Object.values(paths['/webhooks/whatsapp'])) {
  op['x-implementation-status']='IMPLEMENTED';
  op.summary=op.summary.replace('PROPUESTA: ','');
  op.responses['429']={$ref:'#/components/responses/Error429'};
  op.responses['500']={$ref:'#/components/responses/Error500'};
}
for (const [path,status] of [['/health','ok'],['/ready','ready']]) {
  paths[path]={get:{operationId:path.slice(1),summary:'Estado operativo sin información sensible',
    'x-implementation-status':'IMPLEMENTED',security:[],parameters:[],responses:{
      '200':response(object({status:en(status)})),
      ...(path==='/ready'?{'503':{$ref:'#/components/responses/Error503'}}:{}),
      '500':{$ref:'#/components/responses/Error500'}
    }}};
}
const doc = { openapi:'3.1.0',info:{title:'Agente-IA — contrato canónico',version:'0.4.0',description:'Fase 4: API operativa interna IMPLEMENTED; sin despliegue público ni OpenAI ni Meta outbound.'},paths,components:{securitySchemes:{supabaseBearer:{type:'http',scheme:'bearer',bearerFormat:'JWT'}},responses:errorResponses,schemas:S} };
const serialized = JSON.stringify(doc,null,2) + '\n';
const runtime=fileURLToPath(new URL('../apps/api/src/generated/contract.ts',import.meta.url));
const runtimeText='// Generated by scripts/build-openapi.mjs. Do not edit.\nexport default '+JSON.stringify(doc)+';\n';
if(process.argv.includes('--check')){if(readFileSync(runtime,'utf8').replace(/\r\n/g,'\n')!==runtimeText.replace(/\r\n/g,'\n'))throw Error('Runtime contract drift');}else{writeFileSync(runtime,runtimeText);}
if (process.argv.includes('--check')) {
  if (readFileSync(target,'utf8').replace(/\r\n/g,'\n') !== serialized.replace(/\r\n/g,'\n')) throw new Error('OpenAPI difiere del generador; ejecutar node scripts/build-openapi.mjs');
  console.log(`OpenAPI consistente: ${count + 4} operaciones canónicas (todas IMPLEMENTED).`);
} else { writeFileSync(target,serialized); console.log(`Escrito ${target}`); }
