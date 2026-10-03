# Fase 2 — implementación y límites

Base aprobada: `aea0bbc0762d2200641b253f4f23fa518c4dfe41`. Rama exclusiva: `codex/phase-02-backend-foundation`; PR #4 sigue Draft. Arquitectura y lifecycle canónicos conservados.

## Estado verificable

| Área | Estado | Alcance |
|---|---|---|
| apps/api, Node.js + TypeScript + Fastify | IMPLEMENTED | composición HTTP, módulos identity/inbox, puertos/repositorios, errores seguros y logs JSON |
| Configuración | IMPLEMENTED | carga .env nativa Node y validación tipada fail-fast; nunca imprime valores |
| GET /health, GET /ready | IMPLEMENTED | proceso vivo; DB/roles/esquema/RLS comprobados sin exponer datos |
| GET /webhooks/whatsapp | IMPLEMENTED | challenge literal con token comparado mediante digests timing-safe |
| POST /webhooks/whatsapp | IMPLEMENTED | raw Buffer, HMAC SHA256 antes de JSON, 1MiB, lotes completos, normalización, transacción durable y dedupe lógico |
| Supabase Auth / GET /v1/me | IMPLEMENTED | JWT JWKS ES256/RS256, iss/aud/exp/iat/sub, memberships activas DB; sin rol confiado desde frontend |
| GET /v1/businesses/{business_id} | IMPLEMENTED | lectura mínima canónica y caso negativo de aislamiento; recurso ajeno devuelve404 |
| PostgreSQL/Supabase | PARTIAL | cuatro tablas y RLS/GRANT probados en PostgreSQL17.11 aislado; conexión a proyecto Supabase real no realizada |
| Idempotencia | PARTIAL | inbox UNIQUE por mensaje/estado, canonical hash, rollback de lote y concurrencia; claves de comandos panel/outbox aún PLANNED |
| Webhook oficial en Meta | PARTIAL | ingreso HTTP funcional probado sintéticamente; registro público/número real/sandbox Meta no conectados |
| Worker, OpenAI, carrito/pedidos, pagos, envío Meta, SSE/WS | PLANNED | no implementados ni simulados como servicios funcionales |

El resto de endpoints OpenAPI permanece PLANNED. `x-implementation-status` permite distinguirlos. Las seis operaciones implementadas no implican despliegue ni URL pública.

## Ejecución reproducible

Node >=22.13, npm y PostgreSQL17 local o DB de test descartable. Dependencias backend fijadas exactamente con package-lock; el panel conserva su manifiesto y componentes.

```sh
npm ci
npm run typecheck
npm run api:build
npm run api:test
npm run admin:build
node scripts/build-openapi.mjs --check
node scripts/validate-architecture.mjs
git diff --check
```

`api:test` levanta cluster PostgreSQL temporal bound a127.0.0.1 con initdb/pg_ctl, aplica migración y fixtures sintéticas, prueba roles no privilegiados y lo detiene. Detecta binaries Windows en `C:\Program Files\PostgreSQL\17\bin`; en Linux `/usr/lib/postgresql/17/bin`; PG_BIN permite otra ubicación. CI usa un servicio descartable `postgres:17.11`. Si se proporciona TEST_DATABASE_URL, debe apuntar a loopback, base cuyo nombre termina `_test`, sin query overrides y sin schema app existente. Rechaza otros destinos; nunca usa DATABASE_URL para preparar tests. No hay skips silenciosos de DB. `auth.users` se sustituye por fixture mínima solo en los tests de PostgreSQL puro; no modifica Supabase Auth real.

Para ejecutar API: preparar DB **local** mediante migración revisada, provisionar usuarios de conexión separados y configurar .env ignorado; `npm run api:dev` o `npm run api:start` tras build. Escucha127.0.0.1:PORT por defecto. No ejecuta migraciones al iniciar. No ofrece credenciales/test accounts predeterminados en el servidor operativo. Migración generada con CLI oficial2.119.0, sin link remoto.

## Configuración por modo foundation

Obligatorias: DATABASE_URL (LOGIN que hereda exclusivamente app_api), WEBHOOK_DATABASE_URL (LOGIN que hereda exclusivamente app_ingress), SUPABASE_URL, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, ADMIN_ALLOWED_ORIGINS. NODE_ENV default development y PORT default3000. SUPABASE_URL debe ser origen HTTPS, o loopback HTTP solo en dev/test. CORS acepta orígenes completos explícitos; producción solo HTTPS. DB remota exige `sslmode=verify-full`; en loopback dev/test puede omitirse TLS. La cuenta postgres/service_role/supabase_admin se rechaza, y al iniciar/readiness también se comprueban atributos reales y pertenencias: sin superuser, BYPASSRLS, DDL/ownership ni combinación API/ingress.

SUPABASE_PUBLISHABLE_KEY es opcional/reservada para Auth del panel; verificación backend usa JWKS, no SDK ni API key. SUPABASE_ANON_KEY legado y SUPABASE_SERVICE_ROLE_KEY restringida no se leen. WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID/API_VERSION y OPENAI_* permanecen reservadas, no son obligatorias porque no hay envío Graph ni IA; los canales reales proceden de DB, nunca del teléfono único del entorno. Un secreto de Meta App por proceso; varios negocios pueden compartir esa App. Múltiples Apps con diferentes secretos requieren ampliación explícita futura.

## Datos y permisos

Migración: `supabase/migrations/20261003154547_backend_foundation.sql`, schema privado app, businesses/business_memberships/whatsapp_channels/webhook_events. UUID, timestamps UTC, versiones con trigger, FK tenant+channel, constraints, índices, unicidad event_key por negocio. RLS habilitada y FORCE en las cuatro tablas, sin SECURITY DEFINER. anon/authenticated sin acceso directo; app_api solo SELECT de negocio/membresías propias. app_ingress resuelve canal con SELECT de columnas mínimas y puede INSERT/SELECT inbox de tenant configurado, sin UPDATE/DELETE. Roles capacidad NOLOGIN; provisionar LOGIN separados y contraseñas por gestión de secretos fuera del repo. No usuarios/contraseñas reales en migración.

Contexto actor/tenant `set_config(...,true)` dentro de transacción, SQL parametrizado y reset al devolver conexión. Inbox hace BEGIN/synchronous_commit=on, resuelve canales activos, inserta cada evento y COMMIT antes de200. Error/rollback o caída DB →503/Retry-After. No hay locking externo ni llamadas IA. Un canal deshabilitado durante recepción puede dejar un evento pending; futuro worker deberá revalidarlo antes de efectos.

Claves de mensaje incluyen phone_number_id y message_id; estados además status/timestamp/error_codes canónicos. Payload guarda contenido mínimo, no envelope completo, contact profile ni medios. IDs alternativos se conservan opacos si vienen en from_user_id; nunca se inventa teléfono. Mensajes largos se recortan a2000 caracteres con flag truncated. Timestamps inválidos/futuros>5min/pasados>90d y formas desconocidas van a dead_letter. No son procesados porque worker sigue pendiente. Retención/purga de payload y tombstones todavía PLANNED.

Canal desconocido/deshabilitado/negocio suspendido: no crear tenant/evento ni ejecutar IA/pedido;200 después de consultar DB y emitir log estructurado configuration_issue (ID de canal hasheado). Cambios sin metadata también se registran sin contenido. Es auditoría operativa en logs; tabla audit_logs/exportación durable de logs y alertas quedan pendientes. No descartar como desconocido si DB falla:503.

## Autenticación y controles

JWT validado criptográficamente con issuer `${SUPABASE_URL}/auth/v1`, audience authenticated y JWKS fija. No URL/algoritmo elegidos por token. Cache máximo10min, fetch timeout3s. HS256 legado rechazado: requiere migrar signing key a ES256/RS256 o futura validación Auth server; sin secreto JWT compartido en runtime. Anonymous y service tokens rechazados. Roles de negocio exclusivamente memberships DB, no user_metadata ni headers. Revocación de membership surte efecto en cada request; logout/revocación de sesión Auth completa no se consulta en DB y depende de expiración JWT (comprobación de sesión sensible aún pendiente).

Request IDs siempre UUID generados por servidor, header X-Request-Id y meta en envelopes. Logs con ruta parametrizada, sin query/token/body/stack ni PII. Límite básico120req/min por IP, en memoria y sin confiar en X-Forwarded-For; excesos429+Retry-After. Es defensa de una instancia: cuotas distribuidas/tenant, proxy confiable y límites de infraestructura antes de producción. Webhooks no recibidos por limitación429 deben ser reintentados por Meta; nunca ACK previo a persistencia. Health/ready excluidos del rate limit para probes. Headers seguros y CORS explícito; el listener local no es despliegue.

## Contrato y decisiones

Ver [extensión OpenAPI](openapi-compatibility.md), [validación](validation.md) y [dependencias](dependency-audit.md). Me/Membership/Business/ApiError y estados no se amplían ni redefinen. No se añaden nombres de negocio al DTO /me: IDs+roles representan negocios autorizados y GET business obtiene nombre cuando lo necesita el panel. Usuario sin membership recibe lista vacía según schema vigente.

Pendientes antes de siguiente fase: proyecto Supabase local completo/Auth real sandbox, provisión/rotación de LOGIN, registro Meta test number y formatos vigentes, límites/retención y logs durables, worker con leases/fencing, readonly/read-models del panel y modifier groups, moneda/impuestos/horarios/zonas/cancelación, hosting/backup y revisión de seguridad. Nada de esto es una funcionalidad instalada.

Fuentes revisadas2026-10-03: [Supabase JWT](https://supabase.com/docs/guides/auth/jwts), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [changelog](https://supabase.com/changelog), [Fastify raw parser](https://fastify.dev/docs/latest/Reference/ContentTypeParser/), [transacciones pg](https://node-postgres.com/features/transactions). Consulta vigente Meta volvió a fallar; se aplican HMAC/challenge aprobados, sin fijar versión Graph no usada ni afirmar prueba real Meta.
