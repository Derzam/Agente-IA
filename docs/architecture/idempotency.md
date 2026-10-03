# Idempotencia y recuperación — propuesta

Garantía: efectos internos atómicos y deduplicados en PostgreSQL; procesamiento y transporte al menos una vez. No garantía exactamente una vez para OpenAI, WhatsApp o futuros pagos.

| Operación | Clave / restricción duradera | Comportamiento |
|---|---|---|
| mensaje entrante | event_key `wa:message:{phone_number_id}:{message_id}`; UNIQUE(business_id,event_key) + messages provider ID | repetición no vuelve a ejecutar agente, carrito ni pedido |
| estado WhatsApp | `wa:status:{phone_number_id}:{message_id}:{status}:{timestamp}:{error_code_or_none}` | mantener cada estado relevante; monotonicidad independiente del orden |
| evento desconocido | canal + tipo + hash canónico de fragmento lógico | se archiva, no ejecuta comando |
| comando panel | Idempotency-Key UUID + business/actor/operation; hash request canónico incluye path y cuerpo | misma clave/cuerpo → respuesta guardada; otro cuerpo → 409 IDEMPOTENCY_CONFLICT |
| herramienta IA mutante | business + conversation + inbound_message_id + action_index persistido + tool_name | plan persistido antes de efectos; retry reutiliza slots, no nuevo plan con nuevos IDs |
| propuesta | UNIQUE(business_id,source_cart_id,source_cart_version) | misma versión retorna propuesta existente; cambiado requiere nueva versión |
| confirmación | challenge ID asociado a cliente/order/version/TTL y key `confirm:{order_id}:{quote_version}` | consume una vez dentro de transaction; lock cart converted impide otro pedido confirmado |
| transición | order + resulting_version único, CAS y clave de comando | no duplica transición ni notificación |
| handoff | parcial unique conversation abierto | peticiones simultáneas retornan handoff existente |
| outbox | `effect:{aggregate_id}:{version}:{event_type}:{recipient}` único | replay de worker no crea otro envío lógico |
| pago MVP manual | order/method único + clave comando | registro auditado una vez, no se cobra |
| pago futuro | proveedor + provider_payment_id único; payment_attempt UUID enviado como clave al PSP que lo soporte | requiere verificación firmada y conciliación; fuera de alcance MVP |

Webhook envelope hash se usa para diagnóstico, no para deduplicar mensajes: mismo mensaje puede reaparecer en otro lote. Deduplicación opera también al escribir messages y efectos, no solo al ingresar webhook.

## Protocolo de comandos

1. Autenticar y autorizar tenant/actor antes de consultar idempotency. Replays jamás devuelven respuesta a otra persona ni tras revocar permiso.
2. Validar esquema, canonizar JSON de comando y hashear (SHA256). La clave se almacena hasheada, la operación y actor forman scope. Iniciar registro bajo UNIQUE en la misma transacción de efectos.
3. Si completed y hash coincide, devolver status/cuerpo del primer resultado y `Idempotency-Replayed: true`. Si distinto, 409. Si in_progress, 409 REQUEST_IN_PROGRESS + Retry-After.
4. Dominio + versión + auditoría + outbox + resultado se confirman juntos. Rollback libera intento de efecto; error de validación no se cachea. Resultados 2xx se guardan; errores recuperables se pueden intentar otra vez con la misma clave.
5. Lease vencido se recupera con fencing token; worker antiguo no puede finalizar. Crash antes de commit no produce efecto; después de commit retorna resultado persistido.

TTL claves panel propuesto 24h; si expira, invariantes permanentes de pedidos/pagos siguen evitando duplicación, pero una edición ordinaria puede ser un comando nuevo. Explicar TTL al consumidor. No reutilizar key entre operaciones ni generar key nueva al reintentar el mismo gesto.

## IA y concurrencia

Persistir propuesta de plan y slots con inbound ID antes de ejecutar herramientas; dedupe tool_call_id del proveedor solo no basta porque una generación repetida puede cambiar IDs. Un turno completado no se regenera al reenviar su webhook. Si cae tras ejecutar herramienta y antes de contestar, reconstruir desde resultados y estado, sin repetir comandos. IA no recibe claves de autorización/challenges. Nunca mantener lock durante llamada externa; CAS valida que carrito/conversación/epoch siguen vigentes al ejecutar.

API/worker serializan comandos sobre agregados con lock y CAS. Handoff y envío compiten con epoch; un envío externo ya iniciado puede terminar tras la pausa, lo cual se registra y muestra. No prometer revocar un mensaje ya enviado. Cada job tiene cuotas/retries y dead letter con replay administrativo que reutiliza claves. Replays antiguos fuera de retención no se aceptan como mensajes nuevos.
