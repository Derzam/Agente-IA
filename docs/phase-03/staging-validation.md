# Validación de Fase 3 en Supabase staging

Destino exclusivo: agente-ia-staging, project ref pqffgbpbreuhivxxctvr, sa-east-1, PostgreSQL 17.11.0.002, ACTIVE_HEALTHY. Se confirmó identidad con get_project antes de SQL. No consultas ni cambios en LlevaKí, mouly-control-de-ingresos o producción.

## Antes de persistir

Inventario inicial: cuatro tablas foundation, migración remota backend_foundation 20261003220149. Security Advisors: cero findings. Performance Advisors: cinco INFO unused_index, sin WARN/ERROR ni críticos.

El SQL completo domain_schema se ejecutó con BEGIN, comprobación de 27 tablas ENABLE/FORCE RLS y ROLLBACK. Una consulta independiente confirmó tables_after_rollback=4, foundation_rls_preserved=true y app.orders ausente. Sin cambios persistentes ni registros de migración durante ese ensayo. Hubo un fallo inicial de sintaxis del bloque de validación construido en JavaScript; se corrigió el escape de $$ y se repitió satisfactoriamente antes de aplicar.

Antes de aplicar se consultaron nuevamente ambos Advisors: mismos resultados sin hallazgos críticos. También pasaron los tests locales reales de PostgreSQL, incluyendo constraints/FKs/RLS, concurrencia, snapshots y challenges.

## Aplicación definitiva y trazabilidad

apply_migration domain_schema devolvió success=true. Se añadió una sola migración a staging; no se insertaron fixtures ni datos de dominio persistentes. SQL nuevo crea 23 tablas y app_worker, constraints/funciones INVOKER/índices/policies/grants, y extiende índices/permisos de foundation. No passwords, LOGIN nuevos, secrets, endpoints, workers o deploys.

| Registro | Versión |
|---|---|
| Archivo creado mediante CLI en Git | 20261004010809_domain_schema.sql |
| Versión asignada por apply_migration MCP en staging | 20261004012831 domain_schema |
| Foundation en Git (sin cambios) | 20261003154547_backend_foundation.sql |
| Foundation previamente aplicada por MCP | 20261003220149 backend_foundation |

Los timestamps MCP y CLI son diferentes. No se alteró el historial remoto ni se editó ninguna migración aplicada. Antes de usar db push/pull sobre este proyecto hay que reconciliar explícitamente esta correspondencia; no reenviar los archivos por timestamp como si fueran pendientes. Esto es un pendiente de operación del CLI, no un cambio del SQL.

Se verificó que SQL Git y el statement almacenado en supabase_migrations.schema_migrations son idénticos normalizando CRLF→LF y whitespace final. SHA256 común:

`8c74c4884604a4b3f6ac7995ef87d91b8e55bdb4995aee38f5487d4850f1085c`

Verificación final directa: 27 tablas, 27 con RLS habilitado y forzado, 0 unsafe; 0 grants de tabla/columna a PUBLIC/anon/authenticated/service_role; 0 SECURITY DEFINER. app_api/app_ingress/app_worker son NOLOGIN y sin superuser, BYPASSRLS, CREATEDB o CREATEROLE. Ninguno tiene CREATE en app.

## Advisors después de aplicar

Security Advisors: **0 hallazgos**, sin críticos.

Performance Advisors: **49 INFO unused_index**, **0 WARN/ERROR**, sin críticos ni FKs sin índice. Se conservan los índices: son estructuras de integridad, búsquedas de FK y accesos previstos sobre dominio recién creado sin carga. No deben eliminarse para silenciar el advisor. Evaluar uso con tráfico y EXPLAIN en la siguiente fase.

Evidencia: [advisors-results.json](advisors-results.json). [Guía de unused_index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Validación reproducible

Backend: 79 aprobadas, 0 fallidas, 0 omitidas (51 previas intactas + 28 nuevas). Panel: 32 aprobadas, 0 fallidas. npm ci, typecheck, API build, admin build/test, OpenAPI, arquitectura, audit backend production y whitespace forman el CI. Los datos de pruebas son sintéticos y se ejecutan en dos bases locales descartables, no en staging.

Pendientes: revisión del PR Draft #8, reconciliación CLI/MCP antes de otra sincronización, coordinación de DTOs de modificadores, servicios de dominio/CAS/auditoría/outbox, validación de argumentos de herramientas, provisión de LOGIN restringidos y validación completa Auth/Meta. No se activó OpenAI ni se enviaron mensajes WhatsApp.

No se realizó merge, deploy ni migración en producción.
