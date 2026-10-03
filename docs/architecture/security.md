# Seguridad y amenazas — propuesta

Estado actual: controles foundation IMPLEMENTED y RLS probada en PostgreSQL aislado; ver [fase 2](../phase-02/implementation.md). Matriz restante es requisito futuro, no garantía de producción. Revocación de membership implementada; revocación inmediata de sesión Auth y controles distribuidos aún pendientes.

Activos: secretos, identidad/PII, precios/pedidos, permisos del negocio, presupuesto IA y disponibilidad. Límites: internet→webhook, panel→API, IA→herramientas, runtime→DB, runtime→proveedores. Cada entrada se trata como no confiable.

| Amenaza | Control exigido | Evidencia de prueba futura |
|---|---|---|
| Webhook falsificado/replay | HMAC de bytes crudos, constant-time, canal registrado, inbox único | firma corrupta/ausente, bytes alterados, lotes repetidos |
| IDOR / negocio ajeno | JWT validado iss/aud/exp/firma, memberships DB activas, tenant por ruta autorizado, FK compuestas | mismo UUID de otro tenant devuelve 404 sin revelar datos |
| Rol manipulado / sesión revocada | nunca user_metadata; membresía DB por request, sesiones verificadas en operación sensible | revocar miembro y reintentar/replay falla 403 |
| Bypass RLS | esquema app privado, grants mínimos, rol runtime sin bypass/DDL/ownership; SET LOCAL por transacción | pruebas con rol runtime y usuario A/B, INSERT/UPDATE tenant ajeno rechazado |
| Prompt injection | mensajes/catálogo/resumen como datos, herramientas whitelist y validación dominio | modelo pide precio 0, SQL o recipient ajeno; sin efecto |
| Precio/estado/pago manipulados | no campos de importe en comandos de carrito; cálculo/snapshots backend; máquina de estados | payload con total/status no permitido →422 |
| Payloads hostiles / SQLi / XSS | límites bytes/profundidad/texto, JSON schema cerrado, SQL parametrizado, texto plano escapado en panel | objetos extra, HTML, SQL y coordenadas inválidas |
| Abuso/DDoS/coste | rate limits por IP+tenant+cliente, límites de cola/tokens, circuit breakers | tenant ruidoso no bloquea otro; 429 + Retry-After |
| Exfiltración secretos/PII | secret manager, redacción, permisos mínimos, minimización OpenAI | logs sin bearer/teléfono/dirección/token/challenge |
| SSRF medios/URLs | no descargar medios MVP; URLs HTTPS allowlist en imágenes, no fetch arbitrario IA | IP privada, file:// y redirect fuera de allowlist rechazados |
| Cambio concurrente/handoff | CAS/locks/epoch antes de mutación y envío | pausa mientras IA calcula invalida resultado |
| Pérdida/ransomware | backup cifrado, credenciales de migración separadas, restauración ensayada | recuperación a entorno aislado con RPO/RTO medido |

## Autenticación y autorización

Supabase Auth gestiona login/refresh/logout con publishable key; no duplicar manejo de contraseñas en API. API acepta bearer access token y verifica criptográficamente contra JWKS/issuer/audience configurados; no confiar en decodificación simple ni getSession local como validación. Rotación de keys/refetch cache acotado. Membership activa de DB define role por negocio; no self-signup con acceso al negocio. Invitación/provisión de miembros fuera de MVP, manual controlada por owner en fase siguiente.

Panel: almacenamiento de sesión según framework futuro, preferir cookies HttpOnly Secure SameSite si SSR/BFF (requiere CSRF); si SPA bearer, gestionar riesgo XSS y CSP sin presentar localStorage como secreto seguro. CORS exacto y Content-Type application/json; no wildcard con credenciales. Roles: owner todos; manager gestión catálogo/config y operación; operator lectura operativa, transiciones permitidas y atención humana, sin modificar precio/config.

En `app` no GRANT a anon/authenticated, RLS de defensa con rol runtime restringido. Auth pública no equivale a permiso de tabla. Si se expone public en futuro, políticas SELECT/UPDATE con USING y WITH CHECK y pertenencia negocio; índices predicates. Views security_invoker cuando soportado; SECURITY DEFINER solo excepcional, schema no expuesto, search_path fijo, EXECUTE revocado de PUBLIC y revisión. Service role/secret key solo para operaciones administrativas explícitas, nunca browser ni consultas normales. Revocar acceso al miembro se comprueba incluso si JWT aún válido.

## Variables y secretos

`.env.example` contiene nombres y vacíos, no tokens. Meta verify/access/app secret separados; OpenAI key backend; DATABASE_URL runtime distinto migrador; Supabase secret/service_role backend solamente. SUPABASE_ANON_KEY legado no concede acceso a negocio; preferir publishable key. Tokens Meta limitados al WABA necesario y rotación planificada. No imprimir entornos completos, Authorization ni query de verificación. Validar config al arrancar; fallar cerrado. Escaneo de Git y CI antes de publicar; si fuga, revocar/rotar, borrar del historial según procedimiento.

Rate limits iniciales propuestos: API 120 requests/min por actor y negocio, mutations 30/min, mensaje cliente 20/min, cuotas IA por tenant; afinar con carga. Webhook valida firma y persistencia con límite global y backpressure: si no se puede persistir, 503 sin descartar silenciosamente mensajes válidos. Exceso cliente se persiste y se difiere/escala, no 200 antes de guardar.

## Datos personales y auditoría

Consentimiento/política de privacidad, residencia de datos, plazos legales y destinatarios externos deben definirse con negocio antes de producción. Logs con IDs opacos y códigos, no cuerpos completos. Teléfono para correlación mediante HMAC con key fuera de logs; hash simple no anonimiza teléfonos. Dirección solo acceso operativo necesario, sin export masiva por defecto. Auditoría append-only de precios, permisos, estado, handoff y pagos; redactar snapshots de PII/secrets. Retención y eliminación detalladas en modelo de datos.

Fuente primaria: [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), revisión inicial 2026-10-02. Revisado [changelog](https://supabase.com/changelog): cambios PostgreSQL 15.19/17.11 afectan ciertas extensiones/operadores; diseño evita depender de ellas. En fase 2 se validan RLS/GRANT de las cuatro tablas mínimas con roles restringidos locales; no implica despliegue o seguridad de las entidades aún PLANNED.
