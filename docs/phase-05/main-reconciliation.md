# Integración de PR #16 con main después de PR #17

Fecha: 2026-10-05. Rama exclusiva `codex/phase-05-staging-runtime-ai-meta`; PR [#16](https://github.com/Derzam/Agente-IA/pull/16). HEAD anterior `c48be1e6aad9ae8cd85d24aee44a11fc8b29f5dd`; main integrado `76e0ddd47affbc28479c9440ae509fa61937709f`, merge de [PR #17](https://github.com/Derzam/Agente-IA/pull/17).

## Conflicto y resolución

Se verificó árbol limpio/rama correcta, se ejecutó `git fetch origin` y se comprobó ancestry del merge de PR #17. Se integró `origin/main` con `git merge --no-commit origin/main`, sin rebase, force push ni estrategias globales ours/theirs. El commit resultante preserva ambos padres; esto es un merge de main dentro de la rama de trabajo, sin fusionar PR #16 hacia main.

**Un archivo con conflicto, un bloque: `package-lock.json`.** Las inserciones adyacentes de `node_modules/openai` y `node_modules/parse5` compartían el cierre del objeto. Se conservaron las dos entradas completas y sus cierres independientes. Se verificó estructuralmente contra las tres versiones Git: todos los paquetes de main permanecen idénticos salvo apps/api, que conserva su entrada con OpenAI; todos los paquetes de PR #16 permanecen idénticos salvo el root, que incorpora jsdom desde main. Sin upgrades de versiones/integrities por regeneración del lockfile.

Dependencias preservadas: OpenAI **7.27.0**, jsdom **26.1.0**, parse5 **7.3.0**, las dependencias backend y Admin completas. package.json de main conserva jsdom como devDependency. `npm ci` pasa y no modifica el lockfile. Audit de producción: cero vulnerabilidades; persisten los cinco high de desarrollo documentados en [toolchain-audit.md](toolchain-audit.md), sin audit fix --force.

## Garantías conjuntas

La UI, adapters, services y hooks coinciden byte por byte con main. Solo se extiende un archivo de pruebas Admin; ningún componente se modifica para conseguir CI verde. Se preservan correlación por outboxId, aislamiento por conversationId, TTL queued, anchorMessageId, requestSequence y nextClientRequestSequence, preferencia de secuencia ante clock skew y fallback temporal conservador. Orden de transcript ASC con desempate ID y sin mutar el array entrante. Scroll se calcula al terminar el POST y solo lleva al fondo si el operador estaba cerca.

El contrato `Message.outbox_id: UUID | null`, sus adaptadores tipados y generador/OpenAPI/runtime contract se conservan desde main. OpenAPI check pasa sin editar a mano archivos generados. El commit de integración conserva el runtime AI/Meta y bootstrap del HEAD anterior. Las correcciones posteriores de revisión se describen abajo; no se reintroducen herramientas arbitrarias ni controles de precios/pagos/estados del modelo.

Regresiones adicionales:

- Proyección canónica Message de un outbound de Fase 5 devuelve el outbox_id correlacionable y el inbound conserva null.
- Meta preflight no llama HTTP si último inbound es de hace 25h, no existe o tiene timestamp futuro; deja META_WINDOW_CLOSED.
- ai_enabled=false bloquea Responses aunque AI_RUNTIME_ENABLED esté habilitado; handoff también bloquea el provider.
- ConversationsView montado con jsdom/React, POST diferido y scroll durante el envío: respeta el viewport al subir y lleva al fondo cuando sigue cerca. Se verifica el comportamiento real del componente, además de las pruebas de reconciliación/polling originales de PR #17.

## Migraciones y validación

Las cuatro migraciones coinciden con PR #16; main no añade cambios SQL incompatibles. `Message.outbox_id` proyecta una columna ya existente y no requiere DDL. No se modifica la migración aplicada `20261004073706_staging_runtime.sql`; SHA256 normalizado sigue siendo `20648b394f8d100e3444e01eef9e095e5e26668fa403e252c1302ae9df32f458`. Todas se ejecutan en PostgreSQL local desechable por la suite, con BEGIN/ROLLBACK de staging_runtime, RLS/privilegios y concurrency. No se ejecuta ninguna migración nueva ni SQL remoto en Supabase por esta integración.

Comandos locales: `npm ci`, `npm run typecheck`, `npm test`, `npm run admin:test`, `npm run build --workspaces --if-present`, `node scripts/build-openapi.mjs --check`, `node scripts/validate-architecture.mjs`, whitespace y audit producción. **490 tests: 360 backend y 130 Admin**, sin fallos/skips. Se conservan los 399 de PR #16, se incorporan 61 de PR #17 y se añaden seis casos de reconciliación y veinticuatro casos de revisión (más assertions de business ai_enabled). Node 24 / PostgreSQL 17.11 local; CI vuelve a validar con Node 22 / PostgreSQL 17.11.

El nuevo SHA, runs CI y revisión `@codex review` se reportan en PR #16. No se usan los checks antiguos de c48be1e como validación de esta integración. El PR solo pasa a Ready for review después de CI nuevo verde, mergeability sin conflictos y revisión nueva sin P1/P2 pendientes. No merge de PR #16 ni activación externa.

## Archivos incorporados o modificados

Desde main: conversationAdapter/menuAdapter, api/client y retryAfter; ApiErrorBanner/StatusBadge; los archivos components/operations; ConversationsView/messageReconciliation, DashboardView, OrdersView y SettingsView; pollingController/usePolling; conversationService/viewModels; adapters.test, operationsPhase5.test, pollingRuntime.test, realApiPhase4.test y runtimeLifecycle.test; packages/shared/src/index.ts; scripts/build-openapi.mjs; docs/api/openapi.json; apps/api/src/generated/contract.ts; root package.json/package-lock.json; docs phase-05 antigravity-init/operations-runtime-ui/toolchain-audit. Son los 39 archivos del merge de PR #17; la lista precisa está en el diff del commit de integración.

Cambios propios de reconciliación: resolución de package-lock.json, regresiones en apps/api/test/phase5-runtime.test.ts y apps/admin/src/test/runtimeLifecycle.test.tsx, esta evidencia y enlaces/estado documental en README/implementation/staging-validation. No modificación de código productivo de main ni de la arquitectura AI/Meta por el merge.

## Correcciones de revisión Codex

La revisión del commit de integración `fe122c0bfc6ca4ff6da6f18de2a3712b4e14a35c` encontró dos hallazgos:

- [P1: API exigía credenciales worker](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4181014171). API ahora usa loadApiRuntime para cursor y scope staging, además de loadConfig para API/ingress. Worker conserva loadRuntime para su conexión/providers/flags/budgets/challenge, sin exigir cursor ni secretos inbound. Las pruebas ejercitan secretos mínimos, accesos prohibidos mediante Proxy, features habilitadas con claves ausentes, rotación y restricciones de staging. La provisión futura debe separar secretos por proceso.
- [P2: reconciliación Meta omitía evento](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4181014181). reconcileStatus captura la versión resultante del UPDATE y emite message.delivery_updated junto con message/outbox/audit en la misma transacción. Duplicados de failed también se descartan. Cuatro pruebas procesan callbacks por inbox para sent/delivered/read/failed y verifican versión, causation, conversation y ausencia de eventos duplicados. Otra prueba revierte la transacción y verifica rollback de todos sus efectos. El flujo HTTP firmado también comprueba el evento.

Archivos adicionales de corrección: apps/api/src/bootstrap/main.ts, apps/api/src/config/runtime.ts, apps/api/src/providers/meta/dispatcher.ts, apps/api/test/phase5-providers.test.ts, .env.example y docs/phase-05/activation-and-security.md; también se actualizan tests/runtime y las evidencias implementation/main-reconciliation ya citadas. No cambios SQL, dependencias ni componentes Admin. Los hilos solo se resuelven tras verificar correcciones y CI del SHA publicado; se solicita nueva revisión antes de Ready.

La segunda revisión sobre `999aa0969b34cf65c566673f91752f90d2950ee1` detectó [P2 de starvation por cuota de customer](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4184186943). Dispatcher ahora reserva las dos cuotas con savepoint y revierte la reserva parcial si se bloquea alguna. Difiere next_attempt_at al próximo minuto con código operacional; no consume intento, fencing ni intención HTTP. Dos pruebas con customers del mismo tenant verifican que el customer saturado no gasta cuota tenant y otro customer avanza, y que el límite tenant difiere sin consumir cuota customer. No se cambia la migración ni se reduce ningún límite.

La tercera revisión sobre `45ae37a17798ba70a309ca1c3aefae99a1d50d0b` detectó dos P2: [aceptación Meta sin evidencia sent](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4184344785) y [status antiguos tras failed](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4184344803). Dispatcher comparte evidencia atómica para todos los cambios efectivos de entrega (aceptación, unknown, dead_letter/preflight, recuperación y callbacks). Un fallo de persistencia tras HTTP conserva intención sending y se recupera unknown sin otro envío. La guarda de timestamp ahora aplica a todo status reconocido; duplicados recientes avanzan solo el watermark. Siete pruebas verifican aceptación desde pending/unknown, callback sent duplicado, rollback de evidencia, recuperación sin resend, estados stale sent/delivered/read y watermark de failed duplicado. No cambios SQL ni al panel.

La cuarta revisión sobre `8b259816f7acc83d63f7b45ea9ae795dc1c0a13d` detectó [P1: sesión vencida en cabecera IA](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4184559500), [P1: replay de mensajes durante handoff](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4184559513) y [P2: rate inbound agotaba retries en la misma ventana](https://github.com/Derzam/Agente-IA/pull/16#discussion_r4184559530). pending ahora excluye sesiones vencidas y turnos con lease vigente, sin bloquear otras conversaciones; recupera lease vencido. Mensajes de atención humana reciben disposición terminal con epoch en conversation_turns, sin proveedor ni consumo. pending/start comparten guarda por historial de handoff, incluyendo timestamp durable del webhook para ingress demorado. RATE_LIMITED difiere al próximo minuto y devuelve el incremento de attempts del claim, conservando fallos anteriores y cuota (rollback). Siete pruebas usan servicios reales de claim/resume y PostgreSQL/RLS: sesión vencida, lease vigente/vencido, human_pending, human_active, ingress demorado y dos alcances de cuota con seis esperas sin dead-letter. Se reutiliza el esquema existente: ninguna migración, DDL, grants ni SQL remoto nuevo.

Archivos de esta ronda: apps/api/src/modules/ai/persistence.ts, apps/api/src/worker/internal-worker.ts y apps/api/src/worker/runtime-worker.ts, además de tests y documentación ya citados. Son **53 archivos acumulados respecto a c48be1e**, con ocho hallazgos corregidos (tres P1 y cinco P2) antes de la siguiente revisión.

## Activación y blockers externos

Se conservan [las restricciones de activación](activation-and-security.md): sin hosting público autorizado/secret manager, sin LOGIN principals provisionados y sin credenciales propias OpenAI/Meta ni destinatario sandbox confirmado. No se crean secretos, infraestructura, dominio ni callbacks reales. Pruebas de providers son fakes; Supabase autorizado sigue siendo agente-ia-staging y no se toca LlevaKí/Mouly/otros proyectos. Estos blockers son de activación, separados de la integración técnica del PR.
