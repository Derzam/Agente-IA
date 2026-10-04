# Fase 2.1 — Validación Supabase de staging

## Estado

No existe todavía un proyecto Supabase dedicado a Agente-IA.

Los proyectos actualmente conectados corresponden a otros sistemas:
- proyecto activo con tablas/migraciones de LlevaKí;
- proyecto inactivo `mouly-control-de-ingresos`.

No reutilizar ninguno de ellos.

## Objetivo

Validar la migración `20261003154547_backend_foundation.sql` y la autenticación real de Supabase en un proyecto aislado de staging antes de avanzar a OpenAI/worker.

## Requisitos del proyecto nuevo

- Postgres 17.
- Proyecto dedicado a Agente-IA.
- API key publishable moderna para frontend.
- JWT Signing Key asimétrica, preferiblemente ES256; RS256 es compatible con el backend actual.
- No usar service_role/secret key en el runtime operativo.
- Mantener `app` como schema privado.
- Crear dos LOGIN restringidos fuera de la migración:
  - uno que herede solo `app_api`;
  - otro que herede solo `app_ingress`.
- Conexiones remotas con TLS y `sslmode=verify-full`.

## Validaciones obligatorias

1. Proyecto `ACTIVE_HEALTHY`.
2. Obtener URL del proyecto y publishable key.
3. Confirmar que el JWKS público contiene una clave asimétrica admitida.
4. Aplicar únicamente la migración foundation de Fase 2.
5. Verificar tablas en schema `app`:
   - businesses
   - business_memberships
   - whatsapp_channels
   - webhook_events
6. Verificar FORCE RLS en las cuatro tablas.
7. Verificar ausencia de grants directos a `anon` y `authenticated`.
8. Ejecutar Security Advisors y Performance Advisors.
9. Crear usuario Auth sintético de staging.
10. Crear membership de prueba.
11. Obtener JWT real y validar:
    - issuer;
    - audience;
    - ES256 o RS256;
    - `GET /v1/me`;
    - aislamiento tenant.
12. Validar revocación de membership con JWT aún vigente.
13. No crear datos reales de clientes.
14. No conectar aún Meta/OpenAI a producción.

## Cambios Supabase 2026 relevantes

- Preferir publishable keys frente a legacy `anon`.
- Las signing keys asimétricas permiten validación local mediante JWKS.
- El backend actual rechaza HS256.
- Las tablas nuevas ya no deben asumir exposición automática al Data API.
- Este proyecto utiliza conexión PostgreSQL directa al schema privado `app`, no Data API para el backend operativo.

## Criterio de salida

Supabase queda aprobado cuando:
- migración aplica sin errores;
- advisors sin findings críticos;
- RLS/roles funcionan;
- Auth real emite JWT compatible;
- `/v1/me` funciona end-to-end;
- no hay acceso cross-tenant;
- no se han usado credenciales privilegiadas en runtime.
