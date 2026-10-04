# Fase 3 — esquema de dominio completo y RLS

Rama: `codex/phase-03-domain-schema`

Base: `main` después de Fase 2.1.

## Objetivo

Completar el modelo persistente del agente sin activar todavía OpenAI, worker, envío Meta ni pedidos reales.

La Fase 3 debe convertir el modelo arquitectónico aprobado en un esquema PostgreSQL multi-tenant con restricciones estructurales, índices, RLS forzado y privilegios mínimos.

## Decisión cerrada: modificadores

Se reemplaza el diseño preliminar de `product_options` por dos entidades explícitas:

- `modifier_groups`: grupo de selección del producto, por ejemplo “Tamaño” o “Extras”.
- `modifier_options`: opciones pertenecientes al grupo, con incremento de precio y disponibilidad.

Esto elimina la duplicación de `required/min_select/max_select` en cada opción y permite validar el grupo una sola vez.

### modifier_groups

Campos principales:

- business_id
- product_id
- name
- required
- min_select
- max_select
- sort_order
- active
- version
- deleted_at

Invariantes:

- `0 <= min_select <= max_select`
- si `required=true`, `min_select >= 1`
- nombre único por producto entre grupos no eliminados
- FK compuesta tenant-safe hacia products

### modifier_options

Campos principales:

- business_id
- modifier_group_id
- name
- price_delta_minor
- available
- sort_order
- version
- deleted_at

Invariantes:

- `price_delta_minor >= 0`
- nombre único por grupo entre opciones no eliminadas
- FK compuesta tenant-safe hacia modifier_groups

Los DTO actuales `ProductOption` podrán mantenerse temporalmente como proyección de compatibilidad en API/frontend, pero la base canónica será grupo + opción.

## Tablas nuevas de Fase 3

1. business_settings
2. customers
3. conversations
4. outbox_events
5. messages
6. categories
7. products
8. modifier_groups
9. modifier_options
10. addresses
11. delivery_zones
12. carts
13. cart_items
14. orders
15. order_items
16. payments
17. human_handoffs
18. audit_logs
19. idempotency_keys
20. order_transitions
21. confirmation_challenges
22. conversation_turns
23. tool_executions

Las cuatro tablas foundation existentes no se recrean:

- businesses
- business_memberships
- whatsapp_channels
- webhook_events

## Convenciones

- UUID generado por servidor.
- `business_id` obligatorio en toda entidad de tenant.
- UNIQUE `(business_id,id)` en toda entidad referenciable.
- FKs internas compuestas por tenant.
- Dinero en `bigint` de unidad mínima.
- Moneda ISO 4217 en mayúsculas.
- Versionado optimista con `version >= 1`.
- RLS habilitado y forzado en todas las tablas.
- Sin grants a `anon`, `authenticated` ni `service_role`.
- Sin `SECURITY DEFINER`.
- Sin cascadas destructivas sobre pedidos, mensajes, pagos o auditoría.
- PII con límites explícitos.
- JSONB acotado por tamaño y tipo.
- Estados mediante CHECK, no texto arbitrario.

## Roles

Se conserva:

- `app_api`: API administrativa/humana.
- `app_ingress`: recepción WhatsApp.

Se propone añadir en esta fase:

- `app_worker`: worker interno para inbox/outbox, orquestación y procesamiento de mensajes.

`app_worker` debe ser NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB y NOCREATEROLE. El LOGIN real se provisionará fuera de migraciones.

## Estrategia RLS

La Fase 3 no confiará en `business_id` del cliente.

Contexto de transacción:

- `app.user_id`
- `app.business_id`

Para acciones humanas:
- membership activa obligatoria;
- acceso limitado al tenant;
- role owner/manager/operator se verificará en políticas o servicio según operación.

Para worker:
- tenant fijado desde channel/evento previamente resuelto;
- privilegios mínimos específicos;
- ninguna capacidad DDL.

## Validación

Antes de formalizar la migración:

1. validar SQL completo en `agente-ia-staging` dentro de `BEGIN/ROLLBACK`;
2. comprobar FKs, índices y CHECK;
3. comprobar RLS/FORCE RLS;
4. comprobar que anon/authenticated/service_role no reciben grants;
5. ejecutar Security Advisors;
6. ejecutar Performance Advisors;
7. extender pruebas PostgreSQL locales;
8. generar la migración formal mediante Supabase CLI cuando esté disponible;
9. aplicar solo a staging;
10. nunca aplicar a LlevaKí ni a `mouly-control-de-ingresos`.

## Fuera de alcance

- OpenAI/tool calling;
- worker ejecutando IA;
- envío WhatsApp;
- cobros electrónicos;
- deploy productivo;
- datos reales;
- políticas fiscales definitivas;
- geocodificación externa.

## Criterio de salida

Fase 3 queda aprobada cuando el esquema formal:

- aplica limpiamente sobre foundation;
- revierte limpiamente en prueba transaccional;
- mantiene aislamiento tenant;
- tiene RLS forzado;
- no introduce findings críticos de seguridad;
- pasa CI y tests de DB;
- está aplicada únicamente en `agente-ia-staging`.
