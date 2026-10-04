# Seguridad y activación de Fase 5

## Autorización vigente

El usuario autorizó únicamente Supabase existente `agente-ia-staging`, ref `pqffgbpbreuhivxxctvr`. No hay proveedor/proyecto de hosting autorizado ni secret manager para este proyecto. No se crean proyectos, despliegues, runtime LOGIN principals ni credenciales externas. No se reutilizan LlevaKí, mouly-control-de-ingresos ni otros proyectos/secrets. No merge ni producción.

No se asume que existan credenciales OpenAI/Meta ni destinatario sandbox autorizado. No pedir ni pegar claves en chat. Todo HTTP a proveedores en tests está reemplazado por fakes/fetch controlado; las pruebas PostgreSQL usan bases locales desechables, sin clientes reales. Migraciones aditivas sobre el Supabase permitido se validan por separado; no activan features ni crean negocio/customer fixtures.

## Threat model del challenge

Material secreto: nonce CSPRNG de 256 bits generado por el dominio y payload de botón que lo contiene. `confirmation_challenges.nonce_hash` conserva únicamente SHA256 del nonce. `transport_cipher` conserva envelope cerrado `{key_version,iv,ciphertext,tag}` cifrado con **AES-256-GCM**, IV aleatorio de 96 bits único (índice único key_version+IV), tag de 128 bits, key version explícita. AAD vincula business/conversation/customer/order/order_version/challenge. Se usa `node:crypto`, sin criptografía propia.

Quote/challenge/ciphertext/message/outbox se confirman en la misma transacción; outbox almacena referencia a challenge y texto canónico, sin botón/nonce. El dispatcher comprueba todos los bindings/TTL/estado/versión y descifra justo antes de HTTP; solo memoria y POST HTTPS de Meta contienen el botón. No se imprime ni se persiste descifrado. Inbound firmado sustituye nonce por evidencia hash antes de inbox; también redacta payloads de confirmación copiados en texto o título. Un cliente no puede usar directamente un hash copiado de DB para confirmar. Un hash persistido no constituye consentimiento.

Protege contra lectura de DB/backups/logs sin la clave externa y contra modificar ciphertext/IV/tag o mover un envelope a otra conversación/tenant. No protege frente a compromiso simultáneo de DB y secret manager/runtime, frente a robo del teléfono autorizado ni frente a acceso al botón recibido en WhatsApp; TLS/firma webhook y bindings siguen siendo necesarios. El TTL y consumo atómico one-shot impiden replay. Cambiar catálogo/quote/order version invalida consentimiento.

Secret manager futuro: claves por versión de 32 bytes aleatorios, inyectadas como `CONFIRMATION_TRANSPORT_KEYS`, con `CONFIRMATION_ACTIVE_KEY_VERSION` para nuevas cotizaciones. Añadir nueva versión, desplegar keyring compartido, empezar a cifrar con nueva clave; conservar anterior hasta expirar todos los challenges y mensajes pendientes asociados. No reencrypt challenges consumidos; no fabricar nuevos challenges para reenviar unknown. Una versión ausente o auth tag incorrecto hace dead_letter seguro antes de HTTP. Retirar claves después del plazo validado y conservar política de recuperación de backups correspondiente. No hay claves reales en Git/DB/documentación.

## Cursor HMAC y configuración

`CURSOR_HMAC_KEY` obligatorio en bootstrap: 32 bytes aleatorios en 64 hex, compartido entre instancias API. `CURSOR_HMAC_PREVIOUS_KEY` admite una clave anterior temporal. Rotar con overlap explícito y acotado: distribuir current=new/previous=old a todas las instancias, retirar previous en fecha acordada y reiniciar paginación de consumidores con 422. Los cursores no tienen TTL propio, por lo que no afirmar invalidación automática a 24h; la retirada de clave es el límite. No reutilizar clave de cifrado. El codec efímero queda únicamente para tests históricos/library bootstrap sin iniciar procesos; el bootstrap operativo nunca usa ese fallback.

Env solo `RUNTIME_ENV=local` o `staging`; staging exige SUPABASE_URL del ref autorizado. Las conexiones remotas requieren sslmode=verify-full; verificar manualmente en secret manager que **las tres URLs DB apuntan al mismo proyecto autorizado**, incluido username/ref de pooler. La comprobación de rol no autentica por sí sola el project ref de una URL DB ajena; no proporcionar URLs de otros proyectos. Los business flags nunca sustituyen secretos/config globales ni verificación de roles.

## Blockers de activación externa

| Elemento | Estado real | Requisito para activarlo |
| --- | --- | --- |
| Hosting API/worker | Pendiente, no autorizado | Selección y autorización explícita del proveedor/proyecto |
| Secret manager | No disponible para este proyecto | Crear únicamente tras autorización del hosting |
| Runtime principals | No provisionados | Tres passwords aleatorias entregadas solo al secret manager, fuera de migraciones/Git/logs |
| OpenAI staging | No ejecutado | Cuenta/clave propia, OPENAI_MODEL y presupuestos aprobados, secretos gestionados |
| Meta sandbox | No ejecutado | App/phone/token/version/verify secret propios y destinatario de prueba confirmado |
| HTTPS/webhook público | No existe URL | Hosting autorizado, TLS y configuración de webhook Meta |

Cada LOGIN principal debe ser miembro de exactamente app_api, app_ingress o app_worker; NO SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE, sin ownership ni grants directos extra. No crear passwords sin canal seguro de entrega. El runtime rechaza mismatches y privilegios peligrosos. La migración conserva roles capability NOLOGIN existentes.

## Prueba externa posterior autorizada

OpenAI: habilitar feature en entorno staging y un negocio sintético con ai_enabled; observar IDs/metadatos/usage, tool loop y handoff con epoch. No asumir que un modelo cualquiera soporte strict tools/reasoning.encrypted_content: validar el modelo elegido con contrato actual y registrar la evidencia real, sin prompts crudos.

Meta: destinatario de prueba autorizado envía inbound al número sandbox; verificar firma/HTTP, inbox, conversación, respuesta/quote interactivo, provider ID de aceptación, callback firmado sent/delivered/read y reconciliación. Confirmar por botón, probar duplicado/replay y pago pendiente. Probar timeout controlado y unknown sin reenvío. Si la versión Graph no devuelve biz_opaque_callback_data, conservar unknown hasta evidencia alternativa; no afirmar reconciliación garantizada sin esta prueba.

Antes de producción: autorizar entorno distinto, resolver advisory de desarrollo coordinando cambios del panel; definir política fiscal/PII y limpieza de ventanas/turnos; pruebas reales OpenAI/Meta y carga multi-instancia; alertas/capacidad/secret rotation/backups; templates y consentimiento fuera de ventana de 24h si se requiere; runbook de revisión de unknown/dead_letter; políticas de retención OpenAI; evaluación de UX de respuestas canónicas. Pagos electrónicos y cambios de estados operativos siguen fuera de tools.
