# Integración de PR #16 con main después de PR #17

Fecha: 2026-10-05. Rama exclusiva `codex/phase-05-staging-runtime-ai-meta`; PR [#16](https://github.com/Derzam/Agente-IA/pull/16). HEAD anterior `c48be1e6aad9ae8cd85d24aee44a11fc8b29f5dd`; main integrado `76e0ddd47affbc28479c9440ae509fa61937709f`, merge de [PR #17](https://github.com/Derzam/Agente-IA/pull/17).

## Conflicto y resolución

Se verificó árbol limpio/rama correcta, se ejecutó `git fetch origin` y se comprobó ancestry del merge de PR #17. Se integró `origin/main` con `git merge --no-commit origin/main`, sin rebase, force push ni estrategias globales ours/theirs. El commit resultante preserva ambos padres; esto es un merge de main dentro de la rama de trabajo, sin fusionar PR #16 hacia main.

**Un archivo con conflicto, un bloque: `package-lock.json`.** Las inserciones adyacentes de `node_modules/openai` y `node_modules/parse5` compartían el cierre del objeto. Se conservaron las dos entradas completas y sus cierres independientes. Se verificó estructuralmente contra las tres versiones Git: todos los paquetes de main permanecen idénticos salvo apps/api, que conserva su entrada con OpenAI; todos los paquetes de PR #16 permanecen idénticos salvo el root, que incorpora jsdom desde main. Sin upgrades de versiones/integrities por regeneración del lockfile.

Dependencias preservadas: OpenAI **7.27.0**, jsdom **26.1.0**, parse5 **7.3.0**, las dependencias backend y Admin completas. package.json de main conserva jsdom como devDependency. `npm ci` pasa y no modifica el lockfile. Audit de producción: cero vulnerabilidades; persisten los cinco high de desarrollo documentados en [toolchain-audit.md](toolchain-audit.md), sin audit fix --force.

## Garantías conjuntas

La UI, adapters, services y hooks coinciden byte por byte con main. Solo se extiende un archivo de pruebas Admin; ningún componente se modifica para conseguir CI verde. Se preservan correlación por outboxId, aislamiento por conversationId, TTL queued, anchorMessageId, requestSequence y nextClientRequestSequence, preferencia de secuencia ante clock skew y fallback temporal conservador. Orden de transcript ASC con desempate ID y sin mutar el array entrante. Scroll se calcula al terminar el POST y solo lleva al fondo si el operador estaba cerca.

El contrato `Message.outbox_id: UUID | null`, sus adaptadores tipados y generador/OpenAPI/runtime contract se conservan desde main. OpenAPI check pasa sin editar a mano archivos generados. El runtime AI/Meta, tools, cipher, budgets/circuitos/epoch/leases/rate limits y bootstrap permanecen iguales al HEAD anterior; no se reintroducen herramientas arbitrarias ni controles de precios/pagos/estados del modelo.

Regresiones adicionales:

- Proyección canónica Message de un outbound de Fase 5 devuelve el outbox_id correlacionable y el inbound conserva null.
- Meta preflight no llama HTTP si último inbound es de hace 25h, no existe o tiene timestamp futuro; deja META_WINDOW_CLOSED.
- ai_enabled=false bloquea Responses aunque AI_RUNTIME_ENABLED esté habilitado; handoff también bloquea el provider.
- ConversationsView montado con jsdom/React, POST diferido y scroll durante el envío: respeta el viewport al subir y lleva al fondo cuando sigue cerca. Se verifica el comportamiento real del componente, además de las pruebas de reconciliación/polling originales de PR #17.

## Migraciones y validación

Las cuatro migraciones coinciden con PR #16; main no añade cambios SQL incompatibles. `Message.outbox_id` proyecta una columna ya existente y no requiere DDL. No se modifica la migración aplicada `20261004073706_staging_runtime.sql`; SHA256 normalizado sigue siendo `20648b394f8d100e3444e01eef9e095e5e26668fa403e252c1302ae9df32f458`. Todas se ejecutan en PostgreSQL local desechable por la suite, con BEGIN/ROLLBACK de staging_runtime, RLS/privilegios y concurrency. No se ejecuta ninguna migración nueva ni SQL remoto en Supabase por esta integración.

Comandos locales: `npm ci`, `npm run typecheck`, `npm test`, `npm run admin:test`, `npm run build --workspaces --if-present`, `node scripts/build-openapi.mjs --check`, `node scripts/validate-architecture.mjs`, whitespace y audit producción. **466 tests: 336 backend y 130 Admin**, sin fallos/skips. Se conservan los 399 de PR #16, se incorporan 61 de PR #17 y se añaden seis casos de regresión (más assertions de business ai_enabled). Node 24 / PostgreSQL 17.11 local; CI vuelve a validar con Node 22 / PostgreSQL 17.11.

El nuevo SHA, runs CI y revisión `@codex review` se reportan en PR #16. No se usan los checks antiguos de c48be1e como validación de esta integración. El PR solo pasa a Ready for review después de CI nuevo verde, mergeability sin conflictos y revisión nueva sin P1/P2 pendientes. No merge de PR #16 ni activación externa.

## Archivos incorporados o modificados

Desde main: conversationAdapter/menuAdapter, api/client y retryAfter; ApiErrorBanner/StatusBadge; los archivos components/operations; ConversationsView/messageReconciliation, DashboardView, OrdersView y SettingsView; pollingController/usePolling; conversationService/viewModels; adapters.test, operationsPhase5.test, pollingRuntime.test, realApiPhase4.test y runtimeLifecycle.test; packages/shared/src/index.ts; scripts/build-openapi.mjs; docs/api/openapi.json; apps/api/src/generated/contract.ts; root package.json/package-lock.json; docs phase-05 antigravity-init/operations-runtime-ui/toolchain-audit. Son los 39 archivos del merge de PR #17; la lista precisa está en el diff del commit de integración.

Cambios propios de reconciliación: resolución de package-lock.json, regresiones en apps/api/test/phase5-runtime.test.ts y apps/admin/src/test/runtimeLifecycle.test.tsx, esta evidencia y enlaces/estado documental en README/implementation/staging-validation. No modificación de código productivo de main ni de la arquitectura AI/Meta por el merge.

## Activación y blockers externos

Se conservan [las restricciones de activación](activation-and-security.md): sin hosting público autorizado/secret manager, sin LOGIN principals provisionados y sin credenciales propias OpenAI/Meta ni destinatario sandbox confirmado. No se crean secretos, infraestructura, dominio ni callbacks reales. Pruebas de providers son fakes; Supabase autorizado sigue siendo agente-ia-staging y no se toca LlevaKí/Mouly/otros proyectos. Estos blockers son de activación, separados de la integración técnica del PR.
