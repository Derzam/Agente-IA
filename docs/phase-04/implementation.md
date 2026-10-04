# Fase 4: servicios de dominio y API operativa

Trabajo sobre `codex/phase-04-domain-services`, PR Draft [#12](https://github.com/Derzam/Agente-IA/pull/12), base `188fb2f1f142513cc2f8b31b544887210b8c4375`. Implementación local verificable; no URL pública, deploy ni merge. OpenAI, Meta outbound y pagos electrónicos permanecen deshabilitados.

## Arquitectura y endpoints

El bootstrap operativo siempre registra las 49 operaciones OpenAPI: 45 administrativas, dos webhook y dos probes. Las ocho rutas adicionales de grupos/opciones cierran explícitamente la incompatibilidad de Fase 3. [Contrato para Antigravity](modifier-contract.md). No se modifica la UI.

HTTP valida JWT, UUID, queries y cuerpos cerrados mediante el mismo OpenAPI generado que utiliza la validación documental. Transport no ejecuta SQL. `DomainTransactions` resuelve membership y rol desde PostgreSQL, fija `SET LOCAL app.user_id/app.business_id`, autoriza y ejecuta los servicios. `CatalogService`, `OperationsService` y `OrderingService` contienen casos de uso; `Repository` proyecta DTOs públicos, reglas de dominio validan dinero, horarios, transiciones y geometría. Auditoría y outbox tienen un módulo separado. Los tres pools usan principales distintos: API, ingress y worker. Readiness rechaza owners, superusers, BYPASSRLS, DDL y membresía en múltiples roles runtime.

CRUD de negocio, settings, categorías, productos, grupos, opciones y zonas; lectura mínima de clientes; pedidos y transiciones; pagos cash; handoffs; conversaciones, mensajes y métricas están implementados. DELETE es lógico, exige CAS y retorna 204. Categories bloquea borrado con productos vivos. Imagen no nula exige HTTPS sin credenciales y hostname en `PRODUCT_IMAGE_ALLOWED_HOSTS`; vacío bloquea todas. GeoJSON se valida también en PostgreSQL. El teléfono se devuelve enmascarado.

Cursor firmado HMAC, ligado a tenant, filtros, colección, limit y orden; categorías `sort_order ASC,id ASC`, otras listas `created_at DESC,id DESC`. La clave es efímera por proceso en esta fase: reinicio invalida cursores; el consumidor debe reiniciar la lista tras 422. No hay total_count. La clave compartida persistente para despliegues con múltiples instancias queda para la configuración de hosting posterior.

## Transacciones, seguridad e idempotencia

Mutaciones administrativas: UUID de Idempotency-Key, scope tenant/actor/operation, SHA256 canónico de path/query/body. TTL 24 horas; lease 30 segundos; fencing monotónico. Advisory try-lock devuelve 409 REQUEST_IN_PROGRESS + Retry-After para ejecución concurrente. Resultado 2xx, estado y cuerpo se guardan con efectos, auditoría y outbox en la misma transacción. El primer resultado y replay usan JSON canónico, incluidos status/meta originales; `X-Request-Id` sigue identificando la petición actual. DELETE conserva cuerpo vacío. Errores no se cachean; rollback no deja efectos ni claves completadas.

La autorización se repite antes del replay, incluyendo asignación de mensajes/resolución y cancelaciones de manager tras downgrade. Un lock compartido de membership y el trigger de cambios de membership serializan revocación con ejecución/replay. Actor y tenant nunca proceden del body ni de headers de permisos. RLS se conserva en las 29 tablas; no se crean SECURITY DEFINER ni roles con BYPASSRLS. `handoff_assignees` es una proyección mínima sincronizada por trigger, con FK a la membership y RLS: permite comprobar asignaciones sin hacer recursiva la política self-read ni exponer memberships mediante un endpoint. Ningún runtime puede modificarla.

Auditoría conserva identificador, versión, estado y valores monetarios canónicos antes/después, sin teléfono, dirección, texto, token ni nonce. Para respetar el allowlist histórico, el importe ocupa `total_minor` y `action` identifica su campo original (`total_minor`, `price_minor`, `price_delta_minor`, `fee_minor` o `amount_minor`); `currency` se incluye cuando existe en la fila. Los cambios derivados de inbox y creación/conversión/expiración de carrito también dejan evidencia, con actor system/customer y causation verificable.

Pedidos: lock conversación → pedido, CAS, acción explícita, matriz pickup/delivery, cancelaciones por rol y motivo; transición, auditoría, outbox y replay atómicos. PostgreSQL vuelve a validar acciones, permisos y challenge. El worker solo puede confirmar propuestas verificadas o cancelar propuestas inválidas/vencidas; no aceptar, preparar ni entregar. El API no puede confirmar clientes. Cash record es manager/owner, usa versión del payment, importe DB, nota y fecha no futura. Payments paid/cancelled no se reabren. Delivered no cambia payment; cancelar conserva pagos ya paid para conciliación. El registro cash no inventa un evento de pago ausente del enum canónico: deja auditoría, sin transport/cobro.

Handoff create/claim/resolve bloquea conversación antes del handoff. Un slot abierto, epoch al crear/resolver, operator solo self-claim y atención asignada; manager/owner asigna miembro activo. Un constraint trigger diferido verifica consistencia conversación/handoff al commit. La revocación del asignado bloquea sus comandos; manager puede cerrar o resolver el handoff. No hay timeout que reanude atención humana. Mensaje humano exige human_active, autorización y ventana de 24h; crea Message pending y outbox whatsapp.message, retorna 202 queued.

## Carrito, cotización y consentimiento

Servicios internos reutilizables: `searchMenu`, `getProduct`, `getCart`, `addToCart`, `removeFromCart`, `setFulfillment`, `requestQuote`, `confirmOrder`, `requestHuman`. Los comandos de carrito/handoff tienen claves durables por customer/conversation/operation. No son endpoints administrativos ni herramientas arbitrarias de LLM. No se fabrican conversation_turns/tool_executions de OpenAI.

Catálogo, settings, moneda, horario, opciones, mínimos y zona se revalidan bajo lock compartido de catálogo; triggers de edición toman lock exclusivo por tenant. El cálculo usa bigint y rechaza overflow antes del DTO. Precio canónico incluye extras; cantidades 1–99, selección por grupo y límites de líneas/opciones. Zona: menor priority, empate por UUID; Polygon incluye límites y excluye agujeros. Descuento autorizado del MVP: exclusivamente cero, sin importe/cupón controlado por IA/frontend.

La extensión opcional `tax_policy` exige configuración explícita: `none` con rate_bps=0 o `exclusive`, rate_bps 0–10000, redondeo por línea half-up. No presupone una tasa legal, no conecta servicios fiscales y no añade una tasa por defecto. Sin política, requestQuote falla con VALIDATION_ERROR. `ai_enabled` se puede almacenar y jamás inicia OpenAI.

Propuesta única por business/cart/cart_version, snapshots, TTL máximo 10 minutos limitado por expiración del carrito y fingerprint de configuración/catálogo. Nonce CSPRNG de 256 bits; solo se devuelve una vez al llamador interno, no va a idempotency/audit/outbox. Repetir requestQuote devuelve la misma propuesta y confirmation_button=null. El ingreso firmado convierte el nonce en evidencia hash antes de persistir inbox/mensaje; botones externos que ya contienen un hash se rechazan. El servicio consume exclusivamente una evidencia interactive del cliente/conversación correctos, challenge/version/TTL actuales y fingerprint revalidado. Texto «sí» no consiente.

QUOTE_CHANGED/QUOTE_EXPIRED cancelan la propuesta con transición/audit/outbox, sin consumir ni renovar consentimiento; se incrementa cart version si aún coincide con la propuesta invalidada. Una siguiente cotización exige un requestQuote explícito. Ningún error emite automáticamente otro challenge. El envío recuperable del botón opaco, sin almacenar nonce plano y con garantías del provider, requiere diseño del transport en Fase 5.

## Worker y ejecución

`npm run api:dev` y `npm run worker:dev`; compilados: `npm run api:build`, `npm run api:start`, `npm run worker:start`. Worker usa únicamente WORKER_DATABASE_URL y app_worker, sin secretos Meta/OpenAI. Remotos exigen sslmode=verify-full y readiness de privilegios. Credenciales no se incluyen aquí ni en migraciones; [operación y staging](staging-validation.md).

Worker descubre IDs de negocios activos (metadata mínima) y fija contexto antes de cada job. Claim con FOR UPDATE SKIP LOCKED, lease, fencing y attempts. Procesamiento y finalización bajo lease válido, retries exponenciales 2–3600s y máximo cinco intentos; fallos permanentes dead_letter. Logs contienen códigos, UUID de job/tenant, estado y contadores, sin cuerpo/nonce/remitente.

Inbox text/interactive/location/unsupported conocido → customer/conversation/message; status es monotónico; desconocidos no ejecutan negocio. Provider-message ID deduplica incluso dos eventos de inbox distintos. Un interactive de confirmación válido puede ejecutar el servicio determinista; errores de challenge no pierden el mensaje entrante ni dejan efectos parciales. Atención humana no se reactiva por expiración de sesión.

Outbox interno entrega a un receptor PostgreSQL: recibo único y status sent se confirman juntos, como evidencia real del efecto interno. whatsapp.message se excluye de claim y sigue pending; ningún provider stub declara éxito ni simula envío externo. Unknown/sent no se reenvían ciegamente. No existe transport Meta, OpenAI ni cobro.

## Verificación y pendientes

Tests históricos intactos en sus bases desechables de Fases 2/3; Fase 4 usa otra base local y principales API/worker/ingress restringidos. La suite incluye matriz completa, permisos/revocación, replay exacto, concurrencia, rollback, catálogo y GeoJSON, carrito, quotes/challenges, pipeline firmado, leases/fencing/retries/DL y outbox. Resultados definitivos y ledger en [staging-validation.md](staging-validation.md).

La auditoría de producción del API devuelve cero vulnerabilidades. La auditoría completa detecta cinco high del toolchain de desarrollo Tailwind 3 propagadas desde braces; [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) no publica parche. No se aplica un upgrade major de la UI fuera de alcance ni un audit fix --force. Antigravity debe coordinar la migración del toolchain; esto queda registrado como pendiente antes de producción.

Fase 5: consumir rutas jerárquicas y deprecación del puente legacy; configurar principales LOGIN, hosting y claves externas; definir transport de challenge y Meta con reconciliación; orquestador IA con plan/slots/epoch, cuotas y presupuesto; política fiscal de cada negocio y retención/PII; configuración de cursores entre instancias; resolver advisory de desarrollo. Ninguno se activa por marcar ai_enabled.
