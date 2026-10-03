# Contratos API v0.1 — propuesta, sin servidor

Especificación máquina: [openapi.json](openapi.json), OpenAPI 3.1. Tipos: [packages/shared](../../packages/shared/README.md). No hay URL operativa, SDK, implementación ni autenticación instalada. Los ejemplos usan UUID ficticios y datos sintéticos.

## Reglas comunes

Base `/v1/businesses/{business_id}`. JWT Supabase en `Authorization: Bearer …`; comprobar membership activa por request y rol, nunca confiar en business_id del cuerpo. Recurso ajeno/inexistente →404; membership ausente →403. Read roles O/M/A: operator/manager/owner. Gestión M/A: manager/owner. Restricciones por estado y asignación se aplican además del rol.

Mutaciones JSON con esquema cerrado, `Idempotency-Key` UUID obligatorio y `expected_version` en actualización/acción; creación no necesita version salvo agregado padre indicado. Respuesta 200/201 `{data,meta:{request_id}}`; listas añaden pagination. 202 significa outbox encolado, no enviado. DELETE lógico responde 204 sin cuerpo y expected_version como query. Replay autorizado devuelve status/cuerpo original con Idempotency-Replayed:true. UUID y fechas RFC3339; dinero entero en unidad mínima y currency ISO. No aceptar campos extra.

Listas: limit 1–100, default 20; cursor opaco ligado a tenant/filtros/orden, inválido →422. Orden estable created_at DESC,id DESC; catálogo sort_order/ID cuando aplique, especificado en operación. Filtros solo documentados. No total_count costoso. Si no hay más: next_cursor:null, has_more:false. Los errores comparten cuerpo abajo. HTTP comunes: 400 JSON inválido, 401 token inválido, 403 permiso, 404 recurso, 409 conflicto, 422 validación, 429 rate limit + Retry-After, 503 dependencia no disponible, 500 error interno con request_id sin stack.

## Endpoints administrativos

La tabla y OpenAPI definen método, ruta, request y response. Los errores comunes anteriores aplican a todas las rutas autenticadas; columna errores enumera diferencias de negocio. Nombres de cuerpo/response remiten a schemas concretos en OpenAPI y tipos shared. Todas las rutas de negocio llevan prefijo base; `/v1/me` es excepción.

| Método/ruta | Propósito / request | Respuesta | Permisos / errores específicos |
|---|---|---|---|
| GET /v1/me | sesión validada, sin cuerpo | 200 Me con memberships | autenticado;401 |
| GET base | negocio, sin cuerpo | 200 Business | O/M/A |
| PATCH base | BusinessUpdate (name/timezone opcionales, expected_version) | 200 Business | M/A;VERSION_CONFLICT; moneda no cambia en MVP |
| GET /settings | configuración | 200 BusinessSettings | O/M/A |
| PATCH /settings | SettingsUpdate | 200 BusinessSettings | M/A;VERSION_CONFLICT; validar intervalos sin solapamientos |
| GET /categories | lista cursor/limit | 200 Page Category | O/M/A |
| POST /categories | CategoryInput | 201 Category | M/A;409 nombre activo duplicado |
| PATCH /categories/{category_id} | CategoryUpdate | 200 Category | M/A;VERSION_CONFLICT |
| DELETE /categories/{category_id} | expected_version query | 204 | M/A;409 si productos activos vinculados |
| GET /products | cursor/limit, category_id?, available? | 200 Page Product | O/M/A |
| POST /products | ProductInput | 201 Product con options vacías | M/A;422 moneda/categoría inválida |
| GET /products/{product_id} | detalle | 200 Product | O/M/A |
| PATCH /products/{product_id} | ProductUpdate | 200 Product | M/A;VERSION_CONFLICT |
| DELETE /products/{product_id} | expected_version query | 204, soft delete | M/A;VERSION_CONFLICT |
| POST /products/{product_id}/options | ProductOptionInput | 201 ProductOption | M/A;422 grupo incompatible |
| PATCH /products/{product_id}/options/{option_id} | ProductOptionUpdate | 200 ProductOption | M/A;VERSION_CONFLICT |
| DELETE /products/{product_id}/options/{option_id} | expected_version query | 204 | M/A;VERSION_CONFLICT |
| GET /delivery-zones | cursor/limit | 200 Page DeliveryZone | M/A |
| POST /delivery-zones | DeliveryZoneInput | 201 DeliveryZone | M/A;422 polígono inválido |
| PATCH /delivery-zones/{zone_id} | DeliveryZoneUpdate | 200 DeliveryZone | M/A;VERSION_CONFLICT |
| DELETE /delivery-zones/{zone_id} | expected_version query | 204 | M/A;VERSION_CONFLICT |
| GET /orders | cursor/limit, status?, customer_id? | 200 Page Order | O/M/A |
| GET /orders/{order_id} | detalle con snapshots | 200 Order | O/M/A |
| POST /orders/{order_id}/transitions | OrderTransitionInput action/reason/expected_version | 200 Order | O/M/A según matriz lifecycle;INVALID_ORDER_TRANSITION/VERSION_CONFLICT;reason obligatorio cancel |
| GET /orders/{order_id}/payments | lista cursor/limit | 200 Page Payment | O/M/A |
| POST /orders/{order_id}/payments/cash-record | PaymentRecordInput | 200 Payment | M/A;409 ya registrado/importe inconsistente;no cobro real |
| GET /customers | cursor/limit | 200 Page Customer (teléfono enmascarado) | O/M/A |
| GET /customers/{customer_id} | detalle mínimo | 200 Customer | O/M/A |
| GET /conversations | cursor/limit,status? | 200 Page Conversation | O/M/A |
| GET /conversations/{conversation_id} | estado de atención | 200 Conversation | O/M/A |
| GET /conversations/{conversation_id}/messages | cursor/limit | 200 Page Message | O/M/A;contenido sensible requiere sesión operativa |
| POST /conversations/{conversation_id}/messages | HumanMessageInput | 202 MessageReceipt | asignado o M/A y human_active;HANDOFF_REQUIRED/WINDOW_CLOSED/VERSION_CONFLICT |
| GET /handoffs | cursor/limit,status? | 200 Page HumanHandoff | O/M/A |
| POST /conversations/{conversation_id}/handoffs | HandoffCreateInput | 201 HumanHandoff (200 si ya abierto) | O/M/A;VERSION_CONFLICT |
| POST /handoffs/{handoff_id}/claim | HandoffClaimInput | 200 HumanHandoff | O se asigna a sí mismo;M/A asigna miembro activo;VERSION_CONFLICT |
| POST /handoffs/{handoff_id}/resolve | HandoffResolveInput | 200 HumanHandoff | asignado o M/A;VERSION_CONFLICT |
| GET /metrics | from/to RFC3339, rango <=31 días | 200 Metrics | M/A;422 rango |

Metrics usa ventana `[from,to)`: pedidos por confirmed_at, cancelados por transición a cancelled, handoffs por created_at; sales_minor suma total de pedidos delivered cuyo evento de finalización cae en rango, independientemente del pago. No se presenta como ingreso cobrado. Moneda del negocio, generated_at del cálculo; respuestas no contienen datos de clientes.

cash-record exige expected_version del Payment pendiente (obtenido por GET payments), paid_at no futuro y note obligatoria; lock payment/order, amount_minor es total calculado por backend, nunca un campo del request. No marca paid en pedido cancelled ni awaiting_confirmation. El operador no tiene permiso para este registro. Settings opening_hours usa day 0=domingo, HH:mm y periodos del mismo día; cruces de medianoche se dividen, horarios superpuestos se rechazan. Update parcial requiere al menos un campo además de expected_version.

Auth: panel llama directamente a Supabase Auth para login password, refresh y logout mediante SDK oficial y publishable key; no `/v1/login` inventado. Login input email/password, response access_token/refresh_token/expires_in/user según contrato proveedor vigente; 400 credenciales o request inválidos,429 límite. Refresh input refresh_token, response sesión,400 token inválido; logout bearer sesión,204 éxito,401 inválido. Ver [Auth proveedor](https://supabase.com/docs/reference/javascript/auth-signinwithpassword). Estos contratos externos no se versionan como API propia; su SDK y gestión segura se fijarán en fase 2. GET /v1/me enlaza sesión con permisos internos.

## Webhooks e interfaces fuera del panel

GET/POST `/webhooks/whatsapp` se describen en OpenAPI e [integración](../architecture/whatsapp-integration.md), no llevan bearer ni Idempotency-Key. Confirmación, carrito y dirección son comandos internos del canal, no endpoints públicos de administración en MVP. Pagos electrónicos, administración de miembros, exportación PII y stream SSE/WebSocket están fuera de contrato implementable de esta fase.

## Ejemplos

POST `…/orders/22222222-2222-4222-8222-222222222222/transitions`, con bearer y Idempotency-Key ficticia:

```json
{"action":"accept","expected_version":2,"reason":null}
```

409 si otro operador actualizó pedido:

```json
{"error":{"code":"VERSION_CONFLICT","message":"El pedido cambió; actualiza antes de repetir la acción.","details":[],"retryable":false},"meta":{"request_id":"33333333-3333-4333-8333-333333333333"}}
```

El panel recupera versión actual y pide una nueva decisión, no reintenta automáticamente la acción con version nueva. En fallo de red puede repetir el comando original con misma clave/cuerpo.

```json
{"data":[],"meta":{"request_id":"33333333-3333-4333-8333-333333333333"},"pagination":{"next_cursor":null,"has_more":false,"limit":20}}
```

## Errores y eventos compartidos

ErrorCode está en shared/OpenAPI: VALIDATION_ERROR(422), UNAUTHENTICATED(401), FORBIDDEN(403), NOT_FOUND(404), VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/REQUEST_IN_PROGRESS/INVALID_ORDER_TRANSITION/QUOTE_CHANGED/QUOTE_EXPIRED/PRODUCT_UNAVAILABLE/DELIVERY_UNAVAILABLE/BUSINESS_CLOSED/HANDOFF_REQUIRED/WINDOW_CLOSED(409), RATE_LIMITED(429), PROVIDER_UNAVAILABLE(503), INTERNAL_ERROR(500). 400 usa VALIDATION_ERROR para sintaxis. `details` solo field/issue sin valor sensible; retryable solo para operación segura recuperable.

DomainEvent: event_id, business_id, type, resource_id, resource_version, occurred_at, request_id. Types: order.created, order.status_changed, conversation.updated, message.received, message.delivery_updated, handoff.created, handoff.resolved. Entrega al menos una vez, dedupe event_id y solo aplicar version mayor; detectar saltos y refrescar recurso. Estos son eventos internos propuestos, no stream disponible. MVP panel hace polling cada 5–10s mientras visible, backoff ante 429, refresh al recuperar foco; futuro transporte se acordará sin duplicar modelos.
