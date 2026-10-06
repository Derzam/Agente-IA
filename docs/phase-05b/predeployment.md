# Fase 5B: preparación previa al primer deploy

Fecha de verificación: 2026-10-05 (America/Guayaquil). Rama exclusiva `codex/phase-05b-staging-activation`, [PR #18](https://github.com/Derzam/Agente-IA/pull/18). Esta autorización posterior permite preparar principals y secretos en Railway; sustituye los blockers iniciales de hosting/secret manager de Fase 5 para este alcance. No autoriza deploy, merge, producción, dominio público ni activación de providers.

## Entornos verificados

- Supabase: `agente-ia-staging`, ref `pqffgbpbreuhivxxctvr`, PostgreSQL 17, ACTIVE_HEALTHY.
- Railway: `Agente-IA Staging`, environment `staging`; servicios nuevos `api` y `worker`, cambios STAGED. Ambos muestran ausencia de deployment activo y servicio no expuesto.
- Defender bloqueó Railway CLI según el usuario. No se volvió a ejecutar ese binario, no se restauró ni se añadieron exclusiones. La preparación usa la sesión autenticada del Dashboard oficial de Railway y Supabase CLI autenticado.

## Principals y conexiones

| Principal LOGIN | Capability única | Conectividad TLS | Validación runtime |
| --- | --- | --- | --- |
| agente_api_runtime | app_api | OK | checkDatabaseRole(api): OK |
| agente_ingress_runtime | app_ingress | OK | checkDatabaseRole(ingress): OK |
| agente_worker_runtime | app_worker | OK | checkDatabaseRole(worker): OK |

Los tres tienen LOGIN e INHERIT; SUPERUSER, BYPASSRLS, CREATEDB y CREATEROLE son falsos. Membresía exactamente una, sin ADMIN OPTION, ownership ni dependencias ACL directas. Los capability roles conservan NOLOGIN y sus controles existentes.

Passwords independientes de 48 caracteres alfanuméricos generadas con CSPRNG local. La biblioteca oficial libpq 17 genera verificadores SCRAM-SHA-256 con `PQencryptPasswordConn`; las contraseñas originales no se interpolan en el SQL enviado. [Motivo documentado por PostgreSQL](https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQENCRYPTPASSWORDCONN). Provisión fuera de migraciones, validada primero mediante BEGIN/ROLLBACK y comprobación de cero principals después del rollback, luego COMMIT y consultas de catálogo. No se cambian migraciones, tablas, RLS ni datos de negocio.

La conexión directa no resolvió desde el equipo local. El Dashboard del proyecto autorizado proporcionó el **session pooler** `aws-0-sa-east-1.pooler.supabase.com:5432`, base `postgres`, usuario `<principal>.pqffgbpbreuhivxxctvr`. Las tres URLs guardadas usan `sslmode=verify-full`. No se usa transaction pooler ni se presupone conectividad IPv6 desde Railway, que todavía no ejecuta containers. [Conexiones y alternativas IPv4](https://supabase.com/docs/guides/database/connecting-to-postgres).

La CA pública se descargó desde el enlace SSL del Dashboard, se verificaron sus datos X.509 y la cadena/hostname TLS del pooler. [Certificado oficial](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). El archivo público [supabase-root-2021.crt](../../config/certs/supabase-root-2021.crt) tiene fingerprint SHA256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` y vence el 2031-04-26. `Dockerfile.staging` lo incluye e indica `NODE_EXTRA_CA_CERTS`; API y worker mantienen verificación de certificados y hostname. Reemplazar por una CA oficial vigente cuando Supabase rote certificados; nunca desactivar TLS para resolver un fallo.

Las pruebas locales utilizaron `createPool` y `checkDatabaseRole` del API compilado, la misma CA adicional y las URLs equivalentes a las guardadas en Railway. API e ingress pasaron al primer intento; worker pasó en un segundo intento de lectura. Esto acredita conectividad local y roles, no un arranque/deploy de Railway.

## Variables guardadas como STAGED

Solo NODE_ENV, RUNTIME_ENV y SUPABASE_URL son referencias compartidas sin credenciales. Los secretos se asignan individualmente al servicio correspondiente, sin .env común.

API (10 nombres):

```text
NODE_ENV
RUNTIME_ENV
SUPABASE_URL
HOST
DATABASE_URL
WEBHOOK_DATABASE_URL
CURSOR_HMAC_KEY
META_VERIFY_TOKEN
META_APP_SECRET
ADMIN_ALLOWED_ORIGINS
```

Worker (8 nombres):

```text
NODE_ENV
RUNTIME_ENV
SUPABASE_URL
WORKER_DATABASE_URL
AI_RUNTIME_ENABLED
META_OUTBOUND_ENABLED
CONFIRMATION_ACTIVE_KEY_VERSION
CONFIRMATION_TRANSPORT_KEYS
```

AI_RUNTIME_ENABLED y META_OUTBOUND_ENABLED son `false`. Confirmation usa versión `v1` y una clave CSPRNG de 32 bytes, distinta del cursor HMAC (también 32 bytes). Verify token y app secret bootstrap tienen 32 bytes CSPRNG cada uno. META_APP_SECRET contiene únicamente el bootstrap temporal autorizado; debe sustituirse por el App Secret real antes de conectar cualquier webhook Meta real. No se configuraron claves OpenAI, token Meta outbound, phone ID ni destinatarios sandbox.

## Validación y límites

Build API y verificaciones reales de los tres principals pasan. Security Advisors: cero hallazgos. Performance Advisors: un INFO unused_index, sin WARN/ERROR; [remediación](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). No se elimina un índice por ausencia de tráfico de staging.

Los archivos temporales tuvieron ACL restringida al usuario local y la identidad sandbox de Codex. `.staging-secrets/` queda excluido tanto de Git como del contexto Docker. Los ocho archivos temporales y su directorio fueron eliminados. El escaneo de 224 archivos rastreados/candidatos no encontró ninguna de las credenciales generadas ni URLs secretas en los cambios.

El PR conserva el ajuste previo del worker para usar WORKER_HEALTH_PORT, después PORT de Railway y finalmente 3001, con su regresión existente. La CA pública resuelve el fallo local SELF_SIGNED_CERT_IN_CHAIN sin alterar controles de dominio. El build de contenedor y health/readiness HTTP alojados no se han ejecutado; no existe URL pública.

Antes del primer deploy: autorización explícita del usuario y CI verde del SHA final del PR. Antes de activar OpenAI/Meta: credenciales propias, configuración/modelo y presupuestos aprobados, App Secret real, destinatario sandbox autorizado y pruebas reales. La preparación termina en STAGED, sin Deploy/accept-deploy/redeploy/generate-domain ni merge.
