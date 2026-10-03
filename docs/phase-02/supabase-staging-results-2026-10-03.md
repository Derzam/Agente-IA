# Resultado de validación Supabase staging — 2026-10-03

Proyecto: `agente-ia-staging`  
Project ref: `pqffgbpbreuhivxxctvr`  
Región: `sa-east-1`  
PostgreSQL: 17.11  
Estado: `ACTIVE_HEALTHY`

## Aislamiento

Se confirmó que este proyecto fue creado exclusivamente para Agente-IA.

No se modificaron:
- el proyecto Supabase de LlevaKí;
- `mouly-control-de-ingresos`.

## Migración aplicada

Se aplicó únicamente:

`backend_foundation`

Origen del SQL:

`supabase/migrations/20261003154547_backend_foundation.sql`

Resultado: SUCCESS.

## Esquema creado

Schema privado `app` con:

- `businesses`
- `business_memberships`
- `whatsapp_channels`
- `webhook_events`

Las cuatro tablas están vacías tras la migración.

## RLS

Validación directa en PostgreSQL:

| Tabla | RLS | FORCE RLS |
|---|---|---|
| businesses | true | true |
| business_memberships | true | true |
| whatsapp_channels | true | true |
| webhook_events | true | true |

## Grants públicos

Consulta a `information_schema.role_table_grants` para:

- `anon`
- `authenticated`
- `service_role`

Resultado: **0 grants** sobre tablas del schema `app`.

## Roles de capacidad

`app_api`:
- NOLOGIN
- NOSUPERUSER
- NOBYPASSRLS
- NOCREATEDB
- NOCREATEROLE

`app_ingress`:
- NOLOGIN
- NOSUPERUSER
- NOBYPASSRLS
- NOCREATEDB
- NOCREATEROLE

Los LOGIN reales del runtime siguen pendientes y deben crearse por separado con credenciales de staging gestionadas fuera del repositorio.

## API keys

El proyecto dispone de una publishable key moderna habilitada.

La legacy anon key existe por compatibilidad, pero no se usará como configuración preferida del frontend.

No se registran valores de claves en este documento.

## Advisors

Security Advisors: **0 hallazgos**.

Performance Advisors:
- cinco avisos INFO por índices todavía sin uso;
- esperado porque la base de staging está vacía;
- no se eliminan los índices, ya que corresponden a rutas previstas de acceso.

## Pendientes para cerrar Auth end-to-end

1. Confirmar JWT Signing Key asimétrica del proyecto (ES256 preferida; RS256 compatible).
2. Crear usuario Auth sintético de staging mediante Supabase Auth.
3. Crear business + membership de prueba.
4. Probar token real contra `GET /v1/me`.
5. Verificar revocación de membership con token aún vigente.
6. Crear los LOGIN restringidos de API e ingress usando secretos de staging.
7. Desplegar backend de staging y probar conexión TLS real.

## Meta sandbox

No se ha conectado todavía una Meta Developer App ni un número de prueba.

Se mantiene pendiente:
- callback HTTPS de staging;
- Verify Token;
- App Secret;
- phone_number_id de sandbox;
- prueba real HMAC/deduplicación/retry.

## Estado

Base Supabase foundation: **APROBADA EN STAGING**.

Auth end-to-end y Meta sandbox: **PENDIENTES**.

No se realizó ningún cambio en producción.
