# Fase 3 — Antigravity: Panel administrativo con dominio completo y modificadores canónicos

**Base:** `main` @ `6060d6b337707729cdebcc4f7200e10fd321b8e3`  
**Rama:** `antigravity/phase-03-admin-domain`  
**PR Draft:** Hacia `main` (sin merge ni deploy a producción)

---

## 1. Resumen ejecutivo

En la Fase 3, el panel administrativo (`apps/admin`) se adapta al modelo de dominio definitivo multi-tenant desarrollado en coordinación con Codex (PR #8). Se integran la decisión canónica de modificadores jerárquicos (`ModifierGroup` y `ModifierOption`), el ciclo de vida de pedidos diferenciado por fulfillment (`delivery` vs `pickup`), el flujo de registro de pagos en efectivo (`cash-record`), la gestión de zonas de entrega sin dependencias de mapas ficticios, el ciclo de handoff humano con motivos canónicos, y la protección estricta de concurrencia optimista (`expected_version`) e idempotencia (`Idempotency-Key`).

---

## 2. Decisión canónica de modificadores jerárquicos

### 2.1 Modelo conceptual
Se abandona definitivamente el modelo plano de extras. La jerarquía adoptada en el panel administrativo es:

```text
Producto (MenuItem)
  └── Grupo de Modificadores (ModifierGroup)
        ├── id, name, required, min_select, max_select, sort_order, active, version
        └── Opciones de Modificador (ModifierOption)[]
              ├── id, name, price_delta_minor, available, sort_order, version
```

### 2.2 Principios de diseño
- **No mezclar precios:** El precio base del producto y los `price_delta_minor` de las opciones se mantienen estrictamente separados.
- **Moneda canónica:** Se trabaja siempre en unidades menores enteras (`price_minor`, `price_delta_minor`). La UI formatea a moneda decimal para visualización (`$0.00`) sin usar floats como fuente de verdad en mutaciones.
- **Edición jerárquica en UI:** 
  - La edición se realiza en un flujo guiado: Producto → Modal/Sección de Grupos → Configuración de Opciones.
  - Se permite: agregar grupo, editar grupo, ordenar grupo, activar/desactivar grupo, agregar opción, editar opción, ordenar opción, activar/desactivar disponibilidad de opción.
- **Resiliencia de adaptadores (`menuAdapter.ts`):**
  - Si el backend envía `ProductOption[]` planos (`group_key`), el adaptador los agrupa automáticamente en `ModifierGroup[]` con sus respectivas opciones.
  - Si se envían grupos jerárquicos directos, el adaptador los procesa de forma nativa.
  - En mutaciones hacia la API existente, se adapta al contrato `POST /options`, `PATCH /options/{id}` o DTO de producto sin romper la compatibilidad mientras Codex concluye PR #8.

---

## 3. Zonas de entrega (`delivery-zones`)

- **Endpoints oficiales:**
  - `GET /v1/businesses/{business_id}/delivery-zones`
  - `POST /v1/businesses/{business_id}/delivery-zones`
  - `PATCH /v1/businesses/{business_id}/delivery-zones/{zone_id}`
  - `DELETE /v1/businesses/{business_id}/delivery-zones/{zone_id}`
- **Campos administrados:**
  - `name`: Nombre descriptivo (ej. "Zona Centro", "Norte Express").
  - `fee_minor`: Tarifa de envío en centavos (minor).
  - `min_order_minor`: Monto mínimo de pedido en centavos.
  - `priority`: Prioridad numérica de evaluación.
  - `active`: Switch booleano de activación.
  - `polygon_geojson`: Coordenadas o placeholder estructurado GeoJSON.
- **Enfoque de UI:** No se inventan librerías de mapas pesadas ni llamadas a APIs de terceros no acordadas. Se proporciona un editor estructurado con visualización clara de parámetros y estado GeoJSON.

---

## 4. Pedidos y ciclo de vida canónico

### 4.1 Transiciones y acciones
Las mutaciones de estado de pedidos se ejecutan exclusivamente vía:
`POST /v1/businesses/{business_id}/orders/{order_id}/transitions` con payload `{ action, reason, expected_version }`.

Las acciones permitidas según fulfillment son:
- **Delivery:**
  - `awaiting_confirmation` / `confirmed` → `accept` → `accepted`
  - `accepted` → `start_preparation` → `preparing`
  - `preparing` → `mark_ready` → `ready`
  - `ready` → `dispatch` → `out_for_delivery`
  - `out_for_delivery` → `complete` → `delivered`
- **Pickup:**
  - `awaiting_confirmation` / `confirmed` → `accept` → `accepted`
  - `accepted` → `start_preparation` → `preparing`
  - `preparing` → `mark_ready` → `ready`
  - `ready` → `complete` → `delivered` (sin despacho intermedio)
- **Cancelación:** Permitida con `cancel` y motivo obligatorio `reason`.

### 4.2 Integridad histórica de snapshots
Los pedidos muestran los snapshots inmutables guardados al momento de la orden:
- `name_snapshot`
- `option_snapshots` (`name`, `price_delta_minor`)
- `address_snapshot`
- Subtotales, impuestos, envío y descuentos en minor units.
La UI jamás recalcula ni sustituye los datos históricos usando los precios actuales del catálogo.

---

## 5. Pagos en efectivo (`cash_on_delivery`)

- **MVP:** El sistema opera bajo modalidad `cash_on_delivery`.
- **Registro manual:**
  - Endpoint: `POST /v1/businesses/{business_id}/orders/{order_id}/payments/cash-record`
  - Payload: `{ paid_at: string, note: string, expected_version: number }`
  - Cabecera: `Idempotency-Key: <UUID>`
- **Comportamiento UI:**
  - Si un pedido tiene pago `pending`, el panel ofrece el botón "Registrar pago en efectivo".
  - Se solicita una nota opcional/confirmación y se envía la versión esperada del pago.
  - No se implementan pasarelas de pago electrónico ni cobros ficticios con tarjeta.

---

## 6. Conversaciones y Handoff Humano

- **Estados de conversación:** `bot_active`, `human_pending`, `human_active`, `closed`.
- **Motivos canónicos de handoff:**
  - `explicit_request`
  - `misunderstanding`
  - `complaint`
  - `payment_issue`
  - `system_failure`
- **Acciones soportadas:**
  - `createHandoff(conversationId, { reason, context, expected_conversation_version })`
  - `claimHandoff(handoffId, { assigned_user_id, expected_version })`
  - `resolveHandoff(handoffId, { action: 'resume_bot' | 'close', resolution, expected_version })`

---

## 7. Clientes y privacidad

- Se visualiza el cliente con `phone_masked` y `display_name`.
- Se respeta la política de privacidad sin generar PII falso ni almacenar datos no autorizados.

---

## 8. Concurrencia optimista e Idempotencia

- **409 VERSION_CONFLICT:** Ante un conflicto de versión, el cliente muestra el mensaje normativo:
  > *"El registro cambió. Actualiza la información antes de continuar."*
  No se realiza retry automático ni se fuerza la sobrescritura silenciosa.
- **Idempotency-Key:**
  - Toda mutación genera un UUID v4 representativo de la intención del operador.
  - Si una petición falla por error de red o timeout técnico, el retry automático conserva exactamente la misma clave.
  - Cuando el usuario toma una nueva decisión o vuelve a presionar el botón tras un error, se genera una clave nueva.

---

## 9. Compatibilidad y Modo Mock

- Si `VITE_USE_MOCK_DATA=true`, el panel opera con mocks enriquecidos en memoria que reflejan con total fidelidad la jerarquía de grupos de modificadores, zonas de entrega, pagos en efectivo y transiciones canónicas.
- Si `VITE_USE_MOCK_DATA=false`, el panel consume los endpoints `/v1` tenant-scoped asegurando encabezados `Authorization: Bearer <token>`, `Idempotency-Key`, y control de versión.
