# WhatsApp Cloud API — integración propuesta

Usar HTTPS contra Graph API oficial y adaptador propio, no WhatsApp Web. Versión Graph API será explícita en configuración y fijada después de validar documentación y sandbox. No adoptar SDK archivados como runtime. Fase 1 no registra webhooks ni conecta un número.

## Verificación e ingreso

GET `/webhooks/whatsapp`: aceptar `hub.mode=subscribe`, comparar `hub.verify_token` contra secreto configurado; devolver literalmente `hub.challenge` como text/plain 200. Error 403; parámetros ausentes 400. No registrar token ni query completa.

POST misma ruta: capturar cuerpo crudo antes de JSON parsing; validar `X-Hub-Signature-256` (`sha256=` + HMAC-SHA256 con WHATSAPP_APP_SECRET) mediante comparación constante y longitudes válidas. Verify token no firma POST. Firma ausente/inválida → 401; JSON malformado → 400; límite propuesto 1 MiB → 413. Firma no evita replay: se aplica inbox idempotente. No exigir JWT administrativo a Meta.

Recorrer `entry[]`, `changes[]`, `value.messages[]` y `value.statuses[]`, no asumir un mensaje por POST. `metadata.phone_number_id` resuelve canal/negocio, no es teléfono del cliente. `messages[].id` es provider_message_id; `messages[].from`/contacts.wa_id identifica remitente donde se proporcione. Guardar identificador de canal como texto opaco; normalizar E.164 solo si hay teléfono válido, sin adivinar prefijo. Si Meta proporciona identidad alternativa, conservarla como channel_user_id y no inventar número; validar ese formato y compatibilidad en sandbox antes de habilitar. Payload desconocido firmado se registra mínimamente como no soportado y se acusa, sin bucle de retries. Canal no configurado se descarta auditado con 200 y alerta de configuración, sin crear tenant.

ACK 200 tras persistir eventos lógicos duraderos, incluidos duplicados. DB caída → 503. Firma falsa nunca entra al inbox. Mensajes muy antiguos o timestamps futuros anómalos se ponen en cuarentena (no refrescan ventana ni ejecutan pedidos); tolerancia propuesta 5 min futuro y horizonte 90 días pasado, validar configuración antes de producción.

## Tipos iniciales y salida

| Entrada | Normalización / respuesta |
|---|---|
| text | texto acotado, IDs y timestamp; interpretar solicitud |
| interactive button_reply/list_reply | ID opaco mapeado a acción backend; validar conversación/versión/TTL |
| location | coordenadas, nombre/dirección opcionales; confirmar dirección con cliente |
| audio/image/document/otros | unsupported, sin descargar medios; explicar soporte actual u ofrecer humano |
| statuses | sent/delivered/read/failed; actualizar delivery, nunca crear conversación/pedido |

Salida: POST `/{phone_number_id}/messages`, bearer token secreto; recipient del contexto confiable, messaging_product whatsapp, type text/interactive/template. Respuesta devuelve message ID, que se persiste; aceptación HTTP no es entrega. IDs interactive son opacos, no precios ni comandos ejecutables. Un callback de otro cliente/tenant, vencido o reutilizado falla cerrado.

Ventana de servicio: texto libre/interactive solo dentro de 24 horas desde último mensaje entrante válido del cliente. Eventos de estado y mensajes salientes no abren ventana. Fuera de ventana, solo plantilla aprobada aplicable con consentimiento/política vigentes; si no existe, outbox queda bloqueado para acción humana y se muestra WINDOW_CLOSED. Revalidar ventana en cada intento, incluso envío humano. Template IDs/versiones/idioma se configuran; nunca genera o aprueba plantillas la IA. No se habilitan campañas en MVP.

## Errores y reintentos

Persistir código/subcódigo/traza del proveedor redactados. 429 y 5xx recuperables con backoff exponencial+jitter (propuesta 1s hasta 15 min, 8 intentos; respetar Retry-After), circuit breaker y cuotas por tenant. Errores de token/permisos/template/destinatario inválido → fallo permanente o bloqueo de configuración, alerta; sin reintento infinito. Revisión en sandbox de clasificación por códigos Meta antes de producción.

Resultado ambiguo (timeout después de enviar, conexión cortada): marcar outbox `unknown`. Meta puede haber aceptado; no prometer dedupe externa ni reenviar automáticamente. Reconciliar con provider_message_id si se conoce y estados; si no, operador decide con advertencia visible. Nunca repetir efectos de pedido para volver a enviar notificación. Los estados pueden llegar antes de respuesta de envío; conservar evento pendiente hasta correlación. Estados sent/delivered/read progresan; failed tardío se registra sin degradar read/delivered. Conservar timestamps y error por intento.

Meta puede repetir y agrupar eventos: claves detalladas en [idempotencia](idempotency.md). TTL/backoff del proveedor no se fija por memoria; verificar reglas vigentes al implementar y probar replay local más largo que reintentos externos.

## Fuentes y limitación de verificación

Consultadas 2026-10-02: [referencia de payloads publicada por Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference), [ejemplo de verificación publicado por Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/). El segundo es referencia histórica, no recomendación de SDK.
Las páginas actuales de [webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview) y [envío](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages) respondieron HTTP 429 durante revisión. Versión Graph, formatos nuevos de identidad, ventanas/políticas y códigos deben verificarse contra documentación vigente y número de prueba antes de implementación; esta fase no los da por probados.
