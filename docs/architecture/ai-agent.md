# Motor de IA y memoria — propuesta

OpenAI mediante Responses API y function calling; modelo configurable, versión y límites fijados en fase 2. El backend valida JSON Schema estricto (`additionalProperties:false`, todos los campos requeridos; opcionales mediante null), resultados y reglas de negocio. Herramientas se ejecutan secuencialmente, paralelismo mutante deshabilitado. El modelo no contiene token Meta, credenciales ni autorización.

business_id, customer_id, conversation_id, actor y causation_id se inyectan desde contexto confiable. No se aceptan como argumentos escogidos por la IA. Importes/precios/estado/pago proceden del dominio; respuesta económica se renderiza desde DTO backend para evitar contradicción con texto generativo.

## Contrato de herramientas

Todos los resultados: `{ok:true,data:T}` o `{ok:false,error:{code,message,retryable}}`. Campos UUID validados, strings acotados, query máx 100 caracteres, cantidades 1–99. No incluir registros de otros clientes ni secretos. Una herramienta con fallo no habilita respuestas inventadas.

| Herramienta | Entrada del modelo (campos requeridos, null si opcional) | Salida data | Restricciones |
|---|---|---|---|
| get_menu | category_id: UUID/null | categories y products disponibles, next_cursor/null | tenant confiable, max 50 productos, no datos administrativos |
| search_products | query: string, cursor: string/null | items Product[], next_cursor/null | búsqueda parametrizada, límite 20 |
| get_product_details | product_id: UUID | Product y opciones | mismo tenant, no borrado |
| add_cart_item | product_id: UUID, option_ids: UUID[], quantity: integer, notes: string/null, expected_cart_version: integer | Cart con totales backend | opción pertenece al producto; qty acumulada <=99, max 50 líneas; idempotente por turno/slot |
| remove_cart_item | cart_item_id: UUID, expected_cart_version: integer | Cart | solo carrito propio activo |
| get_cart | objeto vacío | Cart | recalcular precios actuales, mostrar cambios |
| set_delivery_address | address_text: string, latitude: number/null, longitude: number/null, instructions: string/null | Address y needs_confirmation:boolean | cliente confirma, coordinates del mensaje de ubicación o entrada explícita; no inventadas por modelo |
| calculate_delivery | address_id: UUID | zone_id/null, fee_minor/null, serviceable:boolean, reason/null | polígonos/configuración backend, no modelo como geocoder |
| create_order | fulfillment: pickup/delivery, address_id: UUID/null, expected_cart_version: integer | Order awaiting_confirmation, expires_at | crea propuesta, no confirma; challenge se envía por backend y no sale al modelo |
| confirm_order | order_id: UUID, expected_version: integer | Order confirmed | habilitada solo por handler de botón con evidencia verificada fuera de argumentos; en turno de texto ordinario no se ofrece |
| request_human_agent | reason: enum de HandoffReason, context: string/null | HumanHandoff | contexto redactado, pause/epoch transaccional; puede repetirse sin duplicar |

Payment, descuento, precio, cambio de estado operativo, SQL, HTTP arbitrario y envío a destinatarios elegidos por IA no son herramientas. El catálogo y mensajes son datos no confiables; instrucciones insertadas en nombres/descripciones no cambian política. Whitelist por estado: handoff abierto solo lectura mínima/control humano; carrito expirado requiere nuevo carrito; confirmación solo evidencia válida. El router determinista procesa botones antes de IA.

## Presupuestos y fallos

Propuesta: máximo 8 llamadas herramienta por turno, 20s llamada OpenAI, 45s turno, 6000 tokens de entrada y 1000 de salida, cuotas/coste diario por negocio. Son límites configurables por verificar con modelo elegido. Dos intentos de comprensión fallidos consecutivos o 3 fallos técnicos en sesión → handoff, con explicación breve del backend. Error/timeouts producen respuesta segura o handoff; nunca estimaciones inventadas de precio o pago. Registrar tokens/coste estimado sin cuerpos completos. Fallback no reejecuta herramienta mutante.

## Memoria acotada

- Últimos 12 mensajes o presupuesto de tokens, lo que sea menor; añadir resumen de máximo 800 tokens. No historia ilimitada.
- Resumen con watermark summary_through_message_id y versión, etiquetado como dato no confiable; no contiene instrucciones autorizantes ni challenge. Solo hasta mensajes anteriores a los recientes para evitar doble conteo.
- Estado estructurado fresco: carrito, pedido activo, fulfillment, dirección confirmada (mínima), handoff, idioma/preferencias consentidas. Este estado sustituye afirmaciones viejas del resumen.
- Sesión expira tras 60 min de inactividad (propuesta configurable); carrito expira 60 min, cotización 10 min. Expiración de sesión no modifica pedido confirmado ni termina handoff humano automáticamente.
- Cerrada/expirada crea nueva conversación al siguiente mensaje; handoff abierto mantiene control humano. Preferencias persisten con consentimiento, sin inferir salud o alergias como hechos; alergias reportadas requieren atención humana.
- Borrado/retención purga también resúmenes, caches y trazas. Minimizar PII enviada a OpenAI; evitar teléfono completo, tokens y dirección detallada salvo necesidad documentada.

## Evaluación

Dataset sintético en español: ambigüedad, menú modificado, prompt injection, rechazo de cobros, cliente pidiendo humano, pérdida de contexto y replays. Evaluar uso correcto de herramienta y coincidencia de datos económicos, no solo fluidez. Revisar políticas de retención de OpenAI y configuración del proyecto antes de producción. Fuente: [Function calling oficial](https://developers.openai.com/api/docs/guides/function-calling), consultada 2026-10-02.
