# Necesidades de Contratos API con Codex — Frontend / Panel Administrativo

> **Versión:** 1.0.0 — Fase 1
> **Área:** Contratos de Integración (Antigravity ↔ Codex)
> **Propósito:** Especificar formalmente los endpoints, modelos de datos, eventos en tiempo real y códigos de error que el panel administrativo (`apps/admin`) requiere del backend (`apps/api`).

---

## 1. Principio de Arquitectura e Independencia

1. **Desacoplamiento de Base de Datos:**
   El panel administrativo **no se conecta directamente a Supabase** para operaciones de negocio. Toda interacción se realiza a través de la API REST intermedia (`apps/api`) para garantizar que las reglas de negocio (validación de inventario, disparadores de WhatsApp, webhooks de pagos) sean controladas centralmente por el backend.
2. **Formato Estándar de Respuesta:**
   Todas las respuestas JSON respetarán la estructura estándar:
   ```typescript
   // Respuesta Exitosa
   interface ApiResponse<T> {
     success: true;
     data: T;
     meta?: {
       page?: number;
       limit?: number;
       total?: number;
     };
   }

   // Respuesta de Error
   interface ApiErrorResponse {
     success: false;
     error: {
       code: string;       // Código semántico en UPPER_SNAKE_CASE
       message: string;    // Mensaje legible en español
       details?: unknown;  // Errores de validación por campo (opcional)
     };
   }
   ```

---

## 2. Enums Compartidos (Shared Enums)

Estos tipos se compartirán en `packages/shared`:

```typescript
// Estados del Pedido
export type OrderStatus =
  | 'pending'           // Pedido confirmado por cliente, pendiente de ingresar a cocina
  | 'in_kitchen'        // En preparación en cocina
  | 'out_for_delivery'  // En ruta con el repartidor
  | 'ready_for_pickup'  // Listo en mostrador para retiro del cliente
  | 'delivered'         // Completado y entregado al cliente
  | 'cancelled';        // Anulado

// Modalidad de Entrega
export type FulfillmentType = 'delivery' | 'pickup';

// Estado y Método de Pago
export type PaymentStatus = 'pending' | 'paid' | 'pay_on_delivery' | 'failed';
export type PaymentMethod = 'cash' | 'card_on_delivery' | 'bank_transfer' | 'online_link';

// Estados de la Conversación
export type ConversationStatus =
  | 'bot_active'     // IA respondiendo automáticamente
  | 'waiting_human'  // Cliente en espera de atención humana (Alerta activa)
  | 'human_active'   // Operador del panel atendiendo manualmente
  | 'resolved';      // Conversación cerrada

// Remitente del Mensaje
export type MessageSender = 'customer' | 'bot' | 'staff' | 'system';

// Tipo de Contenido del Mensaje
export type MessageContentType = 'text' | 'image' | 'location' | 'order_summary' | 'internal_note';
```

---

## 3. Matriz de Endpoints Requeridos por Pantalla

### A. Dashboard Operativo (`/dashboard`)

| Método | Endpoint | Descripción | Payload Esperado | Respuesta Clave |
|---|---|---|---|---|
| `GET` | `/api/v1/dashboard/metrics` | Métricas y KPIs de la jornada activa | Query: `?date=YYYY-MM-DD` | `new_orders_count`, `in_kitchen_count`, `waiting_human_count`, `daily_sales_total`, `average_ticket`, `top_items[]` |
| `PATCH`| `/api/v1/business/status` | Switch de emergencia para pausar local | `{ is_accepting_orders: boolean, reason?: string }` | `{ is_accepting_orders: boolean }` |

---

### B. Gestión de Pedidos (`/orders`)

| Método | Endpoint | Descripción | Payload / Parámetros | Respuesta Clave |
|---|---|---|---|---|
| `GET` | `/api/v1/orders` | Listar pedidos con filtros y paginación | Query: `status`, `fulfillment_type`, `search`, `page`, `limit` | `{ orders: Order[], meta: { total, page } }` |
| `GET` | `/api/v1/orders/:id` | Detalle exhaustivo de un pedido | Param: `id` | `Order` (con ítems, modificaciones, dirección, historial) |
| `PATCH`| `/api/v1/orders/:id/status` | Transición de estado del pedido | `{ status: OrderStatus, note?: string }` | `Order` actualizado con timestamp |
| `POST` | `/api/v1/orders/:id/cancel` | Cancelación formal de la orden | `{ reason: string }` | `{ success: true, cancelled_at: string }` |

---

### C. Bandeja de Conversaciones (`/conversations`)

| Método | Endpoint | Descripción | Payload / Parámetros | Respuesta Clave |
|---|---|---|---|---|
| `GET` | `/api/v1/conversations` | Listado de conversaciones activas | Query: `status`, `assigned_to`, `page` | `{ conversations: ConversationSummary[] }` |
| `GET` | `/api/v1/conversations/:id/messages` | Historial de mensajes de un chat | Param: `id`, Query: `before_id?` | `{ messages: ChatMessage[] }` |
| `POST` | `/api/v1/conversations/:id/messages` | Enviar mensaje manual o nota interna | `{ content: string, type: 'staff' \| 'internal_note' }` | `ChatMessage` creado con estado `sent` |
| `POST` | `/api/v1/conversations/:id/takeover` | Operador toma control (pausa IA) | `{ operator_id: string }` | `{ status: 'human_active', assigned_to: string }` |
| `POST` | `/api/v1/conversations/:id/return-to-bot` | Devolver conversación al bot de IA | `{ send_reentry_message: boolean }` | `{ status: 'bot_active' }` |
| `POST` | `/api/v1/conversations/:id/resolve` | Cerrar conversación | `{ resolution_note?: string }` | `{ status: 'resolved' }` |

---

### D. Menú y Catálogo (`/menu`)

| Método | Endpoint | Descripción | Payload / Parámetros | Respuesta Clave |
|---|---|---|---|---|
| `GET` | `/api/v1/menu/categories` | Listar categorías activas | - | `Category[]` |
| `POST` | `/api/v1/menu/categories` | Crear nueva categoría | `{ name: string, sort_order: number }` | `Category` |
| `GET` | `/api/v1/menu/items` | Listar productos del menú | Query: `category_id?`, `is_available?` | `MenuItem[]` con precios y modificadores |
| `POST` | `/api/v1/menu/items` | Crear nuevo plato | `{ name, category_id, price, description, image_url, modifier_group_ids }` | `MenuItem` |
| `PUT` | `/api/v1/menu/items/:id` | Modificar plato existente | Mismo payload de creación | `MenuItem` actualizado |
| `PATCH`| `/api/v1/menu/items/:id/availability` | Switch rápido de stock | `{ is_available: boolean }` | `{ id: string, is_available: boolean }` |

---

### E. Directorio de Clientes (`/customers`)

| Método | Endpoint | Descripción | Parámetros | Respuesta Clave |
|---|---|---|---|---|
| `GET` | `/api/v1/customers` | Listado de clientes | Query: `search`, `page`, `limit` | `{ customers: Customer[] }` |
| `GET` | `/api/v1/customers/:id` | Ficha e historial de cliente | Param: `id` | `CustomerDetail` (incluye últimos 10 pedidos) |

---

### F. Configuración del Agente IA y Negocio (`/settings`)

| Método | Endpoint | Descripción | Payload / Parámetros | Respuesta Clave |
|---|---|---|---|---|
| `GET` | `/api/v1/settings/agent` | Obtener configuración del bot | - | `AgentConfig` (nombre, tono, mensajes, reglas) |
| `PUT` | `/api/v1/settings/agent` | Actualizar configuración del bot | `AgentConfig` | `AgentConfig` guardado |
| `POST` | `/api/v1/settings/agent/test-prompt` | Probar bot en playground | `{ message: string, simulated_history: [] }` | `{ reply: string, detected_intent: string }` |
| `GET` | `/api/v1/settings/business`| Obtener datos y horarios de tienda | - | `BusinessSettings` |
| `PUT` | `/api/v1/settings/business`| Guardar datos y horarios | `BusinessSettings` | `BusinessSettings` actualizado |
| `GET` | `/api/v1/settings/delivery`| Zonas y tarifas de reparto | - | `DeliverySettings` |
| `PUT` | `/api/v1/settings/delivery`| Guardar parámetros de delivery | `DeliverySettings` | `DeliverySettings` actualizado |

---

## 4. Requerimientos de Eventos en Tiempo Real (Real-time Events)

Para una experiencia operativa sin fricción en cocina y atención, el frontend requiere recibir eventos inmediatos sin necesidad de polling repetitivo:

### Mecanismo Recomendado:
**Server-Sent Events (SSE)** en `/api/v1/events` o canal de **WebSockets**.

### Eventos Críticos:
1. `order:created`: Nuevo pedido confirmado por WhatsApp. Dispara chime acústico y añade tarjeta a la columna "Nuevos".
2. `order:status_updated`: Sincroniza cambios de estado entre tablets de cocina y laptops de caja.
3. `conversation:message_received`: Nuevo mensaje de cliente recibido por webhook de WhatsApp.
4. `conversation:handoff_requested`: Cliente entra en estado `waiting_human`. Enciende el badge de alerta roja en el panel.
5. `menu:stock_toggled`: Si otro operador desactiva un plato, se actualiza la interfaz de inmediato.

---

## 5. Preguntas y Decisiones Técnicas Pendientes para Codex

Para coordinar en Fase 2 de desarrollo:

1. **Protocolo de Autenticación de Administradores:**
   ¿Utilizaremos tokens JWT emitidos por Supabase Auth validados en el middleware de `apps/api`, o la API manejará sesiones con cookies `HttpOnly`?
   *Preferencia Frontend:* Bearer JWT en encabezado `Authorization: Bearer <token>` para simplificar peticiones cross-domain.
2. **Cálculo de Distancia de Delivery:**
   ¿El backend calculará la distancia mediante coordenadas directas (Fórmula Haversine contra la latitud/longitud del local) o integrará la API de Google Maps / OSRM?
3. **Manejo de Concurrencia en Handoff:**
   Si dos operadores intentan hacer clic en "Tomar Control" simultáneamente sobre la misma conversación, la API debe devolver `409 Conflict` al segundo operador con mensaje: *"Esta conversación ya fue asignada a [Operador X]"*.
