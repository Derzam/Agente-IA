# Validación local y staging de Fase 4

Único proyecto autorizado: agente-ia-staging, `pqffgbpbreuhivxxctvr`, PostgreSQL 17.11.0.002, sa-east-1. No se opera sobre LlevaKí ni mouly-control-de-ingresos. No deploy ni migración de producción.

Migración nueva: `supabase/migrations/20261004031246_domain_services.sql`, creada con Supabase CLI 2.119.0. Foundation y domain_schema aplicadas no se modifican. La migración añade tax_policy, ai_enabled almacenable, response_body durable, fulfillment del carrito, fingerprint de quote, proyección de assignees y recibos internos; amplía grants por columnas/policies para los casos de uso y agrega guards/locks/consistencia. Roles siguen restringidos NOLOGIN. Las dos tablas técnicas nuevas tienen ENABLE/FORCE RLS y FKs compuestas cubiertas por su PK.

Antes de persistir: instalación reproducible, typecheck, build/test del panel, build/test backend incluyendo PostgreSQL/RLS/concurrencia, audit API, generación OpenAPI, arquitectura y whitespace. Migración local probada primero con BEGIN/ROLLBACK y luego sobre base *_test desechable. Security Advisors previo: cero hallazgos. Performance previo: 49 INFO unused_index, cero WARN/ERROR; no se quitan índices de integridad/colas en un staging sin carga.

Resultados locales: npm ci, typecheck de todos los workspaces, build API, build y 42 tests del panel, 263 tests backend (incluyen PostgreSQL/RLS y concurrencia), generación OpenAPI pública/runtime, validación de arquitectura y whitespace pasan. Total: **305 tests**, sin fallos ni skips. Las pruebas históricas permanecen intactas. Audit de dependencias de producción del API: cero vulnerabilidades. Audit completo: cinco high del toolchain de desarrollo, documentadas en implementation.md; no se afirma que esa auditoría completa esté limpia.

El SQL candidato y staging-smoke.sql se ejecutaron remotamente en una transacción BEGIN/ROLLBACK antes de persistir. Todas las aserciones pasaron; el rollback conservó las dos migraciones históricas, 27 tablas y cero negocios/memberships. apply_migration devolvió success=true solo para el proyecto autorizado. Después, staging-smoke.sql pasó nuevamente y contó **29 tablas con ENABLE/FORCE RLS**. No se cargaron fixtures, clientes ni datos de negocio y no se provisionaron credenciales runtime.

Ledger verificado (MCP asigna versión remota):

| Nombre | Archivo local | Versión staging |
| --- | --- | --- |
| backend_foundation | 20261003154547_backend_foundation.sql | 20261003220149 |
| domain_schema | 20261004010809_domain_schema.sql | 20261004012831 |
| domain_services | 20261004031246_domain_services.sql | 20261004042412 |

SHA256 del SQL domain_services, normalizando CRLF a LF y eliminando whitespace final: `33a1e390ba812f1b3a8182d15ffcd421edc648f601d7fbcb052f5989e68d1a26`. El digest calculado del archivo local coincide con statements[1] del ledger remoto. La migración aplicada queda inmutable.

Security Advisors después: **cero hallazgos**. Performance Advisors después: **49 INFO unused_index**, el mismo conjunto previo, **cero WARN/ERROR**. En staging vacío no hay evidencia de carga para eliminar índices de integridad, búsqueda o colas. [Descripción y remediación de unused_index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

El workflow Domain and Integration CI ejecuta las comprobaciones anteriores en PostgreSQL 17.11 y Node 22; el estado definitivo del commit publicado se consulta en los checks del PR #12. Las verificaciones locales usan PostgreSQL 17.11 y Node 24.

## Principales runtime y operación posterior

Provisionar tres LOGIN principals por un administrador autorizado, fuera de Git, con contraseñas aleatorias en secret manager y TLS verify-full. Grant exactamente un rol capability: app_api para DATABASE_URL, app_ingress para WEBHOOK_DATABASE_URL, app_worker para WORKER_DATABASE_URL. Sin propiedad de tablas/esquema, CREATE, superuser, BYPASSRLS, membresía en otros roles ni privilegios directos extra. El runtime verifica estas condiciones antes de iniciar. No copiar contraseñas ni URLs autenticadas a CLI/logs/PR.

No se crean LOGIN principals ni se publican credenciales mediante esta migración. No se inicia un servicio público/worker contra staging: el worker se verifica con datos sintéticos locales. Mantener Meta outbound y OpenAI desconectados. Las pruebas de dominio/worker usan diferentes bases locales desechables y sus fixtures nunca se copian a staging.

Consultar salud de colas por tenant con app_worker: counts agrupados por status, attempts y next_attempt_at; revisar worker.retry con code/job_id. No imprimir payload, channel_user_id, direcciones, texto ni challenges. Dead-letter requiere revisión y decisión explícita; no hay endpoint de replay inventado ni reenvío de unknown. Una futura reparación debe conservar dedupe y fencing.

MCP asigna timestamps remotos al aplicar migrations; el nombre/SQL/digest vinculan ledger local/remoto. Antes de usar db push, reconciliar las versiones explícitamente según el ledger documentado en Fase 3; no renombrar ni volver a aplicar las migraciones históricas. No ejecutar un push automático que confunda timestamps distintos con cambios pendientes.
