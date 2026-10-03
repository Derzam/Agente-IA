# Fase 2 — Codex: backend funcional y webhook

Base: main @ aea0bbc0762d2200641b253f4f23fa518c4dfe41
Rama: codex/phase-02-backend-foundation

## Objetivo

Convertir la arquitectura aprobada en Fase 1/1.5 en una primera implementación backend verificable, sin desplegar a producción.

## Alcance obligatorio

1. Crear scaffold real de apps/api en Node.js + TypeScript.
2. Configuración tipada con validación de variables de entorno y fail-fast.
3. HTTP server con health/readiness.
4. GET /webhooks/whatsapp para challenge de Meta.
5. POST /webhooks/whatsapp con:
   - raw body;
   - validación HMAC con WHATSAPP_APP_SECRET;
   - límite de tamaño;
   - parsing seguro;
   - recorrido entry[]/changes[]/messages[]/statuses[];
   - resolución de canal por phone_number_id;
   - ACK 200 solo después de persistencia durable;
   - 503 si DB no está disponible.
6. Persistencia durable del inbox webhook_events con deduplicación.
7. Primera migración Supabase/PostgreSQL mínima para:
   - businesses;
   - business_memberships;
   - whatsapp_channels;
   - webhook_events.
8. RLS/roles de defensa según arquitectura, sin service_role en runtime.
9. Verificación JWT Supabase para rutas admin.
10. GET /v1/me con memberships activas.
11. Envelope de errores y request_id según OpenAPI.
12. Idempotencia base para mutaciones futuras.
13. Tests unitarios/integración para webhook, firma, dedupe, auth y tenant isolation.
14. CI que ejecute typecheck, tests, OpenAPI y validación de arquitectura.

## Fuera de alcance

- OpenAI funcional.
- Tool calling.
- Envío real de mensajes a Meta.
- Pedidos/carrito completos.
- Migraciones en producción.
- Secrets reales.
- Pagos.
- SSE/WebSockets.

## Restricciones

- No modificar lifecycle canónico sin PR de contrato.
- Dinero siempre integer minor units.
- business_id nunca confiado desde body.
- No mantener locks/transacciones durante llamadas externas.
- No usar Supabase service_role para consultas normales.
- No escribir secrets en logs ni fixtures.
- No inventar versiones de Meta/OpenAI/Supabase: documentar y verificar antes de fijarlas.

## Criterios de aceptación

- npm ci
- npm run typecheck
- tests backend PASS
- admin build sigue PASS
- OpenAPI check PASS
- architecture validation PASS
- webhook signature tests PASS
- duplicate webhook test PASS
- invalid tenant/channel test PASS
- GET /v1/me auth tests PASS
- no secrets detectados
- PR permanece Draft hasta revisión

## Entregable esperado

Al finalizar, reportar:
- rama;
- commits;
- PR;
- archivos creados/modificados;
- migraciones incluidas;
- endpoints implementados;
- tests ejecutados y conteos;
- decisiones pendientes;
- riesgos conocidos;
- confirmar explícitamente que no hubo deploy ni migración de producción.
