# Fase 4 — Codex: servicios de dominio y API operativa

Base: main @ 188fb2f1f142513cc2f8b31b544887210b8c4375
Rama: codex/phase-04-domain-services

## Objetivo
Convertir el esquema persistente de Fase 3 en servicios de aplicación y endpoints operativos reales, manteniendo OpenAI y WhatsApp outbound deshabilitados.

## Alcance
- Endpoints administrativos pendientes del OpenAPI.
- Idempotencia durable con scope por tenant/actor/operación.
- Transiciones de pedidos con CAS, auditoría y outbox.
- Registro cash_on_delivery.
- Handoff create/claim/resolve.
- Catálogo, settings, delivery zones, customers, conversations y metrics.
- Servicios internos de carrito/cotización/confirmación.
- Worker interno para inbox/outbox, retries y dead-letter.
- Tests API/PostgreSQL/concurrencia y regresión.

## Restricciones
- No modificar UI salvo contratos compartidos imprescindibles.
- No activar OpenAI.
- No enviar mensajes reales por Meta.
- No deploy a producción.
- No tocar LlevaKí.
- No tocar mouly-control-de-ingresos.
- No merge sin autorización.

## Criterio de salida
- CI verde.
- Endpoints implementados coinciden con OpenAPI.
- Idempotencia y transiciones probadas bajo concurrencia.
- RLS/tenant isolation preservados.
- Worker procesa jobs internos sin llamadas externas.
- Staging validado sin datos reales.
