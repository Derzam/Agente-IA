# Política de privacidad de Agente-IA staging

El usuario autorizó una política exclusiva, su publicación HTTPS en el entorno existente y su verificación pública, manteniendo la app Meta sin publicar. Confirmó como responsable a Derly Zambrano y como contacto público de privacidad `derlymoreira192@gmail.com`.

La fuente del contenido publicado es `apps/api/src/modules/privacy/page.ts`, incluida en el build del API. `GET /privacy` es público, estático y no requiere DB, identidad ni configuración adicional. No introduce cookies, scripts, analytics, formularios ni almacenamiento. No refleja query strings. CSP restringe recursos a estilos inline; base, formularios y frames están bloqueados. Se mantienen helmet, logs minimizados y rate limiting existente. No se añaden dependencias, secretos, migraciones, permisos ni endpoints de eliminación automáticos.

El aviso cubre únicamente las pruebas autorizadas de WhatsApp Cloud API: datos de remitente/contenido/metadatos normalizados, estados, infraestructura y contacto de privacidad. Explica que mensajes pueden persistirse en DB aunque no aparezcan en logs. Identifica Meta/WhatsApp, Railway y Supabase; no inventa residencia de datos, cifrado de extremo a extremo del backend, eliminación inmediata de backups, cumplimiento certificado ni Zero Data Retention. IA y outbound automático permanecen desactivados; una futura activación necesita revisar el aviso. Pedidos/pagos/clientes reales están fuera de esta etapa.

La retención de 7/90/180 días del diseño de datos es provisional y no tiene housekeeping implementado: el aviso público no presenta esos objetivos como una purga real. Las solicitudes de acceso/corrección/eliminación se tramitan manualmente por el responsable tras verificación mínima; no se garantiza una función automática inexistente. Antes de producción se deben concretar plazos, base jurídica, contratos/transferencias, backups y operación de solicitudes según la legislación aplicable. No se modifican datos para publicar el aviso.

Referencia consultada: [Política de mensajes de WhatsApp Business](https://business.whatsapp.com/policy), revisada el 2026-10-05, secciones de experiencia, privacidad y minimización. La política de Agente-IA describe su propio tratamiento y no copia políticas de negocios ajenos. No se afirma aprobación legal ni aprobación de Meta.

## Validación y publicación

Destino autorizado: servicio API de Railway `Agente-IA Staging`, entorno `staging`. URL prevista: `https://api-staging-34ac.up.railway.app/privacy`. La existencia de la ruta en local no demuestra publicación; registrar aquí la evidencia HTTP real después del deploy. Mantener bloqueada cualquier continuación dependiente de la URL hasta comprobar HTTPS público y contenido correcto. No pulsar Publicar en Meta.

Dos pruebas HTTP verifican acceso anónimo incluso con servicios privados indisponibles, contrato HTML, no reflexión de parámetros, ausencia de cookies/scripts/formularios, CSP/headers, rate limiting y rechazo de POST. El build y OpenAPI incluyen la nueva ruta; se actualiza el conteo arquitectónico de 49 a 50 operaciones, sin cambiar los 45 endpoints admin.

Validación local: `npm ci`, typecheck, 130 pruebas Admin, build Admin/API, 46 pruebas HTTP/contratos/providers/privacidad y validación OpenAPI/arquitectura. Audit de producción del API: cero vulnerabilidades; audit completo mantiene siete hallazgos en dependencias fuera de ese alcance, sin actualización forzada. La suite PostgreSQL completa no pudo iniciar en Windows: `initdb` falla al cargar `dict_snowball.dll` con error 4551. No se alteró Defender ni la instalación para sortearlo; CI ejecuta PostgreSQL 17 en Linux. Registrar los resultados definitivos de CI y publicación en la evidencia del PR #18.
