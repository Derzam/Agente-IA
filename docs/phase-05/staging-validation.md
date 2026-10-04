# Validación de Fase 5

Fecha: 2026-10-04. Rama `codex/phase-05-staging-runtime-ai-meta`, Draft [PR #16](https://github.com/Derzam/Agente-IA/pull/16), base main `6915aa6cb45d85565856a38dd1f297235f4c26a2`. No merge. [Arquitectura](implementation.md) y [blockers de activación](activation-and-security.md).

## Validación local

Node 24.14.0, npm 11.9.0, PostgreSQL 17.11 temporal sobre loopback. `npm ci`, typecheck de todos los workspaces, build API, build Admin y **67 tests Admin** pasan. Backend **332/332**, sin fallos/skips: 263 históricos + 25 contratos/providers + 44 pruebas runtime PostgreSQL de Fase 5. Total **399 tests**, mantiene los 330 anteriores y añade 69. No cambios al panel ni eliminación de tests históricos.

La suite aplica las cuatro migraciones en base `_test` separada. La nueva migración primero ejecuta BEGIN/ROLLBACK: 32 tablas dentro, nuevas tablas ausentes después. Posteriormente se aplica en la DB local y ejecuta [staging-smoke.sql](staging-smoke.sql) con metadatos/privilegios/RLS/allowlist. LOGIN roles de pruebas son locales y desechables, sin passwords, sobre cluster trust de loopback; nunca se copian a Supabase.

Cobertura: SDK Responses sobre fetch fake (store/model/strict schemas/timeout/429/500), outputs rechazados, presupuesto input/output/Responses/tools y tenant/conversation, límites de loop, circuito durable y half-open, epoch/handoff durante modelo/antes de mutation, duplicate job, SQL slots inmutables, flags, readiness role mismatch/grants directos; Meta respuesta válida/timeout desconocido/429/rechazo/dead-letter, crash tras intención, claim concurrente, status duplicado/fuera de orden/canal incorrecto/desconocido; AES-GCM/tamper/IV único/key rotation/wrong version, challenge TTL/replay/customer/conversation/order version, webhook interactivo duplicado y nonce copiado redactado; cursor compartido/rotación/reinicio, cuotas/HMAC y RLS.

Pipeline integrado local: Fastify recibe webhook con firma HMAC válida, PostgreSQL app_ingress persiste inbox deduplicado, RuntimeWorker procesa conversación y llama provider IA fake, `search_menu` lee datos canónicos, outbox y dispatcher Meta fake guardan ID de aceptación, webhook firmado de status reconcilia delivered sin otro envío. Se verifica que un provider IA bloqueado no detiene otro inbound. Una prueba con fake no acredita que Meta ni OpenAI reales acepten estas credenciales/configuración.

OpenAPI pública/runtime permanece con 49 operaciones; no endpoints IA/prompt/provider payload. Validadores de generación, arquitectura/links/env scan y whitespace forman parte de las comprobaciones y CI. No hay cambio de contrato que requiera coordinar un endpoint nuevo con Antigravity.

Audit producción (`npm audit --omit=dev`): **0 vulnerabilidades**. Audit completo: **5 high** de desarrollo (braces y dependientes chokidar/fast-glob/micromatch/Tailwind 3). [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reportado por npm; no se usa `audit fix --force` ni se hace upgrade major no coordinado del panel. Mantener como pendiente de producción. La dependencia OpenAI queda fijada en lockfile. Docker no está disponible localmente: la imagen de staging se entrega como configuración sin afirmar un build de contenedor ejecutado.

## Migración Supabase autorizada

Único proyecto: `agente-ia-staging`, ref `pqffgbpbreuhivxxctvr`, sa-east-1, PostgreSQL 17.11.0.002. Confirmado ACTIVE_HEALTHY. Previo: 29 tablas, tres migraciones históricas, cero businesses/memberships/customers. Security Advisors: cero hallazgos. Performance Advisors: 49 INFO unused_index; cero WARN/ERROR.

Nueva migración: `supabase/migrations/20261004073706_staging_runtime.sql`, generada con CLI 2.119.0. No se editan foundation/domain_schema/domain_services aplicadas. Añade metadatos turns/tools/transport y tres tablas FORCE RLS (runtime_windows/provider_circuits/ingress_rate_windows), cipher, FK/index y guards invoker. En la nueva redefinición de domain_guard se conserva todo Fase 4: únicamente se selecciona runtime_plan para los nuevos slots y se admite unknown→sent con intención/provider ID/comando de reconciliación verificado, nunca unknown→pending/sending.

El candidato y staging-smoke se ejecutaron remotamente con BEGIN/ROLLBACK: todas las aserciones pasaron y se observaron 32 tablas durante la transacción. Después del rollback se conservaron las tres migraciones, 29 tablas, runtime_windows ausente y cero negocios/clientes. `apply_migration` devolvió success=true únicamente en el ref permitido. Smoke posterior pasó: **32 tablas con ENABLE/FORCE RLS**, cero businesses/memberships/customers.

| Migración | Archivo local | Versión staging |
| --- | --- | --- |
| backend_foundation | 20261003154547_backend_foundation.sql | 20261003220149 |
| domain_schema | 20261004010809_domain_schema.sql | 20261004012831 |
| domain_services | 20261004031246_domain_services.sql | 20261004042412 |
| staging_runtime | 20261004073706_staging_runtime.sql | 20261004133151 |

SHA256 del SQL staging_runtime (CRLF→LF y trimEnd): `20648b394f8d100e3444e01eef9e095e5e26668fa403e252c1302ae9df32f458`. Coincide con statements[1] del ledger remoto. La migración aplicada queda inmutable.

Security Advisors después: **0 hallazgos**. Performance después: **50 INFO unused_index**, cero WARN/ERROR. No se eliminan índices de integridad/colas en un staging sin carga; [descripción/remediación](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). No provisiona LOGIN principals, hosting, secrets ni datos sintéticos en staging. El runtime no aplica migraciones en su arranque. MCP asignó timestamp remoto distinto; vincular nombre/SQL/digest y reconciliar ledger antes de cualquier db push, sin renombrar ni reaplicar migraciones históricas.

## CI y activación

Workflow Domain and Integration CI en Node 22 + PostgreSQL 17.11: npm ci, typecheck, 67 Admin tests/build, API build, suite backend (incluye RLS/concurrency/provider/orchestration), production dependency audit, OpenAPI, arquitectura y whitespace. Se ejecuta tanto en push de esta rama como en PR hacia main. El SHA/checks definitivo se reporta en el PR #16 después de publicar.

URL pública health/readiness: **no existe**. No deploy ni infraestructura de hosting creada. LOGIN principals runtime: **no provisionados**, por ausencia de secret manager autorizado. Meta sandbox y OpenAI staging reales: **no ejecutados**, por falta de credenciales propias y destinatario Meta confirmado. No hay resultados externos inventados; [plan de activación posterior](activation-and-security.md).
