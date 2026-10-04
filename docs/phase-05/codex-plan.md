# Fase 5 — Codex: runtime staging, Meta sandbox y orquestador IA

Base: main @ 6915aa6cb45d85565856a38dd1f297235f4c26a2
Rama: codex/phase-05-staging-runtime-ai-meta

## Objetivo
Activar por primera vez el runtime externo de forma controlada en staging: hosting HTTPS, principales LOGIN restringidos, Meta sandbox/outbound real, transporte recuperable del confirmation challenge y orquestador OpenAI basado en Responses API.

## Alcance
- Provisionar LOGIN principals separados para app_api, app_ingress y app_worker exclusivamente en agente-ia-staging.
- Configurar secretos en el proveedor de hosting; nunca en Git, logs, PR o migraciones.
- Publicar API/worker de staging con TLS y readiness de privilegios.
- Configurar CURSOR_HMAC_KEY persistente y compartida entre instancias.
- Implementar transport Meta Cloud API para whatsapp.message con provider_message_id, retries, reconciliación y estados reales.
- Implementar transporte recuperable del confirmation challenge sin persistir nonce plano.
- Procesar webhooks de delivery/read/failure y reconciliar outbox/message.
- Implementar orquestador IA con OpenAI Responses API; no Assistants API.
- Tool whitelist determinista: search_menu, get_product, get_cart, add_to_cart, remove_from_cart, set_fulfillment, request_quote, confirm_order, request_human.
- Verificar automation_epoch antes y después de cada llamada externa y antes de mutaciones.
- Persistir conversation_turns/tool_executions solo con metadatos permitidos; sin secretos/PII innecesaria.
- Limitar tokens, tool calls, tiempo, retries y presupuesto por tenant/conversación.
- Rate limiting y circuit breakers para OpenAI/Meta.
- Mantener pagos electrónicos fuera de alcance.

## Restricciones
- Solo staging/sandbox; no producción.
- No tocar LlevaKí ni mouly-control-de-ingresos.
- No service_role como runtime.
- No BYPASSRLS, SECURITY DEFINER ni ownership de tablas.
- No auto-confirmar por texto libre.
- No marcar mensajes sent/delivered sin evidencia del proveedor.
- No fusionar sin autorización.

## Criterio de salida
- Staging accesible por HTTPS con health/readiness.
- Principales runtime LOGIN con mínimo privilegio verificados.
- Meta sandbox: envío real + webhook de estado reconciliado.
- Confirmation challenge recuperable y one-shot.
- OpenAI Responses API ejecuta tool loop limitado con datos sintéticos.
- Handoff/automation_epoch cancela resultados IA obsoletos.
- Tests de fallos, retries, duplicate webhooks, budget, timeout y provider reconciliation.
- Security Advisors sin hallazgos críticos y CI verde.
