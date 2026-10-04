# Fase 3: esquema persistente y límites

Base: 6060d6b337707729cdebcc4f7200e10fd321b8e3. Rama codex/phase-03-domain-schema; PR #8 Draft. Migración incremental: supabase/migrations/20261004010809_domain_schema.sql, generada con Supabase CLI 2.119.0. No modifica 20261003154547_backend_foundation.sql ni recrea foundation.

## Estado

| Área | Estado | Evidencia |
|---|---|---|
| 23 tablas de dominio + foundation | IMPLEMENTED | PostgreSQL 17.11 local y staging; 27 ENABLE/FORCE RLS |
| Tenancy y permisos | IMPLEMENTED | FKs compuestas, índices, SET LOCAL, membership activa en API, worker por tenant interno |
| Modificadores | IMPLEMENTED | grupos/opciones, cardinalidad, nombres, soft delete, precio bigint, selección de cart validada |
| Inbox | IMPLEMENTED | controles previos preservados; worker dispone de lease/status, sin runtime nuevo |
| Idempotencia/outbox | PARTIAL | UNIQUE actor/operation/hash y tenant/dedupe, leases/fencing persistidos; unknown/sent no vuelven a pending |
| Confirmación y pedidos | PARTIAL | hash/TTL/bindings/consumo único, estados y snapshots; faltan servicios de acciones y cotización |
| IA recuperable | PARTIAL | turnos únicos, plan limitado de slots/hashes y ejecuciones vinculadas; sin invocar modelos/herramientas |
| APIs nuevas, worker, Meta outbound, cobros | PLANNED | ningún endpoint o proceso nuevo activado |

Tablas nuevas: business_settings, customers, conversations, messages, categories, products, modifier_groups, modifier_options, addresses, delivery_zones, carts, cart_items, orders, order_items, payments, human_handoffs, audit_logs, idempotency_keys, outbox_events, order_transitions, confirmation_challenges, conversation_turns y tool_executions.

## Seguridad y roles

app_api mantiene lecturas foundation y puede leer recursos operativos del tenant con membership activa. owner/manager pueden insertar y modificar columnas permitidas de catálogo/settings/zones; operator solo lee esas entidades. Sin SELECT inbox/outbox/challenges/turns/tools/idempotency ni UPDATE status de pedidos. Sin DELETE histórico ni DDL. Los comandos operativos adicionales requieren servicios y permisos específicos en una fase posterior.

app_ingress conserva únicamente recepción/routing/inbox; sin acceso al catálogo ni a las 23 tablas nuevas. app_worker es NOLOGIN/NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE; lee catálogo/config del tenant y escribe solo recursos de procesamiento. No cambia catálogo/settings/memberships, no recibe UPDATE(status) de orders ni UPDATE de order_items/payments/audit/transitions. UPDATE(updated_by) en orders permite los locks PostgreSQL necesarios para insertar snapshots; no autoriza cambiar el agregado. DELETE solo de cart_items en carrito active. Capability roles no tienen passwords; LOGIN operativo sigue fuera de migraciones.

API usa app.user_id y app.business_id dentro de transacción. Políticas SECURITY INVOKER consultan memberships DB y negocio activo, sin claims frontend. Worker es un proceso interno de confianza: fija tenant desde canal/evento validado, nunca desde frontend. La GUC sola no autentica a un worker ni limita qué tenant puede elegir quien posea sus credenciales; por eso ese rol no se entrega a clientes. Readiness rechaza credenciales mezcladas API/worker y tablas app sin FORCE RLS.

No grants PUBLIC/anon/authenticated/service_role en schema/tablas/columnas/funciones. Revocaciones explícitas neutralizan defaults Supabase; no se usa service_role en runtime. Todos los helpers SECURITY INVOKER y search_path=pg_catalog. La migración extiende permisos/índices de foundation sin modificar su SQL histórico.

## Invariantes persistentes

Dinero: dominio bigint entre 0 y Number.MAX_SAFE_INTEGER; cantidades integer 1–99; currency coincide con negocio para productos/carritos/pedidos y payment con importe/moneda de pedido. Totales y líneas con aritmética numeric entera evitan overflow. Snapshots no siguen precios/nombres del catálogo; confirmados no permiten modificar snapshot del pedido ni sus items. Una sola conversión confirmada por cart permanece incluso si luego se cancela. Estados y relaciones order/customer/conversation/cart/message son explícitos, sin cascadas destructivas.

Cart items validan opciones del producto/tenant disponibles, min/max de grupos, máximo 50 líneas, y fingerprint calculado en DB sobre IDs ordenados para impedir inventarlo. Histórico de opción en pedido es un snapshot cerrado name/price_delta_minor; no FK que permita editarlo con el catálogo. Soft delete solo en customers/categories/products/groups/options/addresses/zones. Retención/anonimización operativa aún no implementada.

JSONB cerrado: horarios (42 intervalos, sin superposición); preferencias solo language; message por kind con coordenadas/texto acotados; selección de UUIDs sin duplicados; snapshots de opciones/dirección; GeoJSON Polygon acotado y anillos cerrados; plan máximo ocho slots de herramientas permitidas con hashes; resultados/audit redacted aceptan solo metadatos primitivos explícitos. Outbox acepta texto opcional y referencia/version de recurso, nunca nonce raw ni envelope arbitrario.

consume_confirmation_challenge es SECURITY INVOKER, solo worker, y actualiza atómicamente un challenge sin consumir, no expirado, con hash/cliente/versión/pedido/mensaje interactive concordantes. Doce consumos concurrentes producen uno. No confirma el pedido por sí sola; texto libre «sí» no es evidencia. Hash SHA256 hexadecimal único; generar nonce CSPRNG >=128 bits en el futuro handler, solo hash en DB. No hay trigger que genere tokens predecibles.

## Pendientes explícitos

Antes de habilitar pedidos: servicio transaccional de acciones con autorización por actor/rol, cálculo/tasa fiscal/moneda, catálogo y horario vigentes, stock/disponibilidad, verificación de la evidencia del botón, CAS/locks y transición+audit+outbox+payment atómicos. La DB almacena y restringe el modelo; no realiza este flujo completo. Servicios deberán hacer revalidación si cambian catálogos/config, incluyendo serialización estable. No ofrecer un PATCH status.

Plan/hashes/resultados redacted son soporte persistente; aún falta especificar y validar los argumentos recuperables por herramienta sin secretos, dedupe de efectos, fencing en finalización de jobs, orquestador y cuotas. Una columna fencing_token por sí sola no implementa exclusión de workers antiguos. No hay replay automático de unknown; conciliación es un comando futuro explícito.

GeoJSON valida estructura, rangos, cierre y tamaño; validación topológica completa de auto-intersecciones/huecos y cotización geográfica requieren servicio antes de delivery. image_url solo admite forma HTTPS acotada, sin descarga; allowlist operativa pendiente antes de ingestión de URLs. Retención PII, backups y provisión/rotación de LOGIN también pendientes. ai_enabled se fuerza false en esta fase.

## Validación y fuentes

Tests originales se conservan intactos; suite nueva en base local separada agente_ia_domain_test. Runner serializa archivos porque roles son globales al cluster. Rechaza bases remotas y no usa DATABASE_URL de runtime. Pruebas backend 79/0/0; panel 32/0. npm ci, typecheck, builds, OpenAPI, arquitectura y whitespace son parte de CI, sin credenciales de staging.

Ver [resultado staging](staging-validation.md) y [compatibilidad ProductOption](modifier-compatibility.md). Changelog y documentación Supabase revisados: [changelog](https://supabase.com/changelog), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [advisors](https://supabase.com/docs/guides/database/database-linter), [FK PostgreSQL](https://www.postgresql.org/docs/17/ddl-constraints.html). La actualización PG 17.11 no afecta este esquema: no usa ltree, cifrado pgcrypto legado, btree_gist ni operadores personalizados.

No se realizó merge, deploy productivo, migración en producción, llamadas OpenAI ni envío WhatsApp.
