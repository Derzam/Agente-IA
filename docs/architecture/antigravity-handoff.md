# Acuerdo de trabajo con Antigravity — propuesta para revisión

Este documento define la interfaz propuesta; no afirma que Antigravity ya la haya aceptado. No se enviaron mensajes a terceros ni se modificó apps/admin. Cambios incompatibles requieren revisión conjunta en PR antes de implementación.

## Fuentes que debe consumir

- [OpenAPI](../api/openapi.json) y [catálogo endpoints](../api/contracts.md): rutas, request/response, roles, errores y headers. Ninguna URL está activa.
- [Shared](../../packages/shared/src/index.ts): Product/Option/Category, Order/Item, Customer, Conversation/Message, Settings, Payment, Handoff, DeliveryZone, paginación y errores. Dinero `*_minor` + currency, UTC → timezone negocio en UI.
- [Máquina de pedidos](order-lifecycle.md): acciones por rol y fulfillment; no PATCH arbitrario de estado ni confirmación por operador.
- [Handoff](human-handoff.md): pausa, asignación y retorno explícito a bot; mostrar cola pending y propietario active.

## Comportamiento UI esperado

Auth con Supabase; GET /v1/me selecciona negocios autorizados. Nunca incluir secret/service_role en bundle. Rutas llevan business_id seleccionado, no permiten cambiar tenant mediante cuerpo. Owner/manager gestionan catálogo, zonas/config; operator ve pedidos/atención y ejecuta transiciones según estado.

Guardar version de cada recurso y enviar expected_version. Generar Idempotency-Key por gesto, conservarla para retry de red, generar otra para intención nueva. VERSION_CONFLICT exige refrescar y decidir; no retry con nueva versión invisible. Renderizar 422 junto al campo, 401 recuperar sesión,403 falta permiso,404 recurso ausente,409 conflicto de negocio,429 backoff y503 indisponibilidad con request_id. Nunca enseñar stack ni secretos.

Precio/total mostrado usa DTO; no recalcular impuestos/envío en frontend como verdad autoritativa. Separar estado pedido, pago y notificación WhatsApp. 202 queued no significa delivered; unknown requiere atención, no botón de reenvío silencioso. Pagos MVP: registro manual efectivo, sin checkout electrónico. Dirección snapshot de pedido no se edita después de confirmar.

Mocks pueden representar estados/errores/enums del contrato. Mostrar acciones autorizadas y deshabilitar las inválidas, pero backend revalida todo. Customer.phone_masked limita listados; detalle de conversación entrega texto necesario a operadores autorizados. No insertar HTML de mensajes. Paginación por cursor, sin número de página inventado; polling temporal mientras visible. DomainEvent es diseño futuro, no dependencia de SSE operativa.

## Dependencias no implementadas

Servidor/worker, package shared publicable, validadores, SDK Auth y provisión de miembros, SQL/RLS, webhooks, OpenAI, zona/horarios fiscales, inbox/outbox, event stream, CI, hosting y alertas. Las pruebas estáticas de esta fase no validan integraciones.

## Decisiones abiertas que requieren información del negocio

País/moneda y política tributaria, horario/timezone, retiro vs delivery, zonas y tarifas/mínimos, medios de pago permitidos, política de cancelación, privacidad/retención, operadores y SLA, templates/consentimiento Meta. Decisiones técnicas: framework panel/Auth persistence, hosting/región, versiones SDK/Graph/modelo, canal futuro de eventos. Ver [registro de decisiones](decisions.md).

Siguiente coordinación: Antigravity revisa pantallas/mock contra OpenAPI y comenta incompatibilidades en PR; Codex prepara fase 2 después de cerrar decisiones bloqueantes. No se publica contrato como API funcional hasta contract tests y backend verificables.
