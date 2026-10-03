# Fase 2 — Antigravity: adaptadores API y autenticación del panel

Base: main @ aea0bbc0762d2200641b253f4f23fa518c4dfe41
Rama: antigravity/phase-02-api-adapters

## Objetivo

Preparar el panel administrativo para consumir la API real sin romper el modo mock ni duplicar lógica autoritativa del backend.

## Alcance obligatorio

1. Mantener USE_MOCK_DATA para desarrollo.
2. Integrar Supabase Auth en frontend usando publishable key.
3. Gestión de sesión:
   - login;
   - refresh;
   - logout;
   - recuperación de 401;
   - nunca exponer service_role.
4. Consumir GET /v1/me.
5. Selección de negocio autorizado.
6. Cliente API real:
   - base /v1;
   - tenant scoped /businesses/{business_id};
   - Authorization Bearer;
   - request_id;
   - timeout/AbortController;
   - errores normalizados;
   - Retry-After para 429.
7. Mutaciones:
   - Idempotency-Key por gesto;
   - reutilizar la misma key en retry de red;
   - expected_version;
   - VERSION_CONFLICT obliga refresh.
8. Crear adaptadores DTO API -> viewModels para:
   - Orders;
   - Conversations;
   - Customers;
   - Menu;
   - Settings;
   - Metrics;
   - Handoffs.
9. No usar PATCH arbitrario de status.
10. Acciones de pedido deben mapear a /orders/{id}/transitions.
11. Handoff debe mapear a create/claim/resolve.
12. Polling 5–10s solo mientras vista visible; backoff al perder foco/429.
13. Estados de carga/error/empty y sesión expirada.
14. Tests de adapters/services y build/typecheck.

## Fuera de alcance

- Supabase migrations.
- Reglas de dominio.
- Cálculo autoritativo de precios/impuestos/envío.
- OpenAI.
- Webhook Meta.
- SSE/WebSockets.
- Deploy producción.

## Restricciones

- packages/shared sigue siendo contrato canónico.
- viewModels son presentación, no contrato backend.
- no acceso directo a tablas privilegiadas.
- no crear endpoints ad-hoc.
- no cambiar enums canónicos sin coordinación.
- no ocultar VERSION_CONFLICT ni reintentar con nueva versión silenciosamente.

## Criterios de aceptación

- npm ci
- npm run typecheck
- npm run admin:build
- tests de services/adapters PASS
- mocks siguen funcionando
- modo real falla de forma explícita si faltan VITE_API_URL/VITE_BUSINESS_ID/session
- no secrets
- PR permanece Draft hasta revisión contra backend Codex

## Entregable esperado

Al finalizar, reportar:
- rama;
- commits;
- PR;
- archivos creados/modificados;
- adapters implementados;
- auth/session flow;
- tests ejecutados;
- incompatibilidades detectadas con OpenAPI;
- riesgos conocidos;
- confirmar que no hubo deploy.
