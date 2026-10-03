# Fase 2 — reconciliación de integración

Rama: `integration/phase-02`.

Esta rama combina el backend aprobado del PR #4 con los adaptadores y autenticación del panel aprobados del PR #5, sin modificar el lifecycle ni los DTO canónicos.

## Resoluciones de conflicto

- `package.json`: conserva scripts API de Codex y añade pruebas del panel de Antigravity.
- `package-lock.json`: une dependencias backend + frontend; `npm ci` es el gate de aceptación.
- CI: ejecuta typecheck, pruebas del panel, build del panel, build API, 51 pruebas backend/PostgreSQL/RLS, auditoría backend, OpenAPI, arquitectura y whitespace.
- `.env.example`: documenta `VITE_USE_MOCK_DATA`, `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Límites actuales

- Backend real implementado: health/readiness, webhooks WhatsApp, `/v1/me` y lectura de business.
- El resto de endpoints administrativos permanece PLANNED en OpenAPI.
- No hay OpenAI, worker de envío, carrito/pedidos backend completos ni deploy.
- La migración Supabase no se aplica a producción.
- Settings no soportados por OpenAPI permanecen deshabilitados en modo real; no se simula persistencia.

La integración solo puede pasar a Ready cuando CI de push y pull_request estén completamente en verde.
