# Especificación Detallada de Pantallas — Panel Administrativo

> **Versión:** 1.0.0 — Fase 1  
> **Área:** UX/UI & Frontend Architecture  
> **Proyecto:** Agente de IA para WhatsApp de Restaurante

---

## 1. Dashboard Operativo (`/dashboard`)

El Dashboard es el centro de control del restaurante durante el servicio activo. Debe responder en 2 segundos a la pregunta: *"¿Cómo va la operación en este momento?"*.

### Componentes de la Pantalla:
1. **Header Operativo:**
   - Nombre de la sucursal y fecha actual.
   - Badge de Estado del Local: `🟢 Abierto y recibiendo pedidos` / `🔴 Pausado (Cierre de emergencia)`.
   - Botón de Switch rápido de Emergencia: Permite pausar la recepción de pedidos si cocina colapsa.
2. **Fila de Tarjetas KPI Clave:**
   - **Nuevos Pedidos:** Número de pedidos confirmados por WhatsApp pendientes de pasar a cocina. Destacado con borde ámbar y animación de pulso si > 0.
   - **En Preparación:** Pedidos activos en cocina/freidora.
   - **En Camino / Por Retirar:** Pedidos despachados en ruta o esperando que el cliente llegue a tienda.
   - **Conversaciones esperando Humano:** Contador en rojo de clientes de WhatsApp en estado `WAITING_HUMAN`. Al hacer clic navega directo a la bandeja filtrada.
   - **Ventas del Día:** Monto acumulado de pedidos completados (\$ USD o moneda local).
   - **Ticket Promedio:** Valor medio por orden del día.
3. **Sección Principal de Dos Columnas:**
   - **Columna Izquierda (65%): Flujo Rápido de Cocina.**
     - Lista compacta de los últimos 5 pedidos que requieren acción inmediata con botones directos: *"Aceptar a Cocina"* o *"Marcar Listo"*.
   - **Columna Derecha (35%): Alertas de Atención y Productos más vendidos.**
     - Mini-bandeja de chats con advertencia de espera.
     - Top 5 platos con mayor rotación en el turno para alertar al chef sobre insumos críticos.

---

## 2. Gestión de Pedidos (`/orders`)

Permite a cajeros, cocineros y despachadores visualizar, clasificar y actualizar el estado de cada pedido de manera rápida y sin fricción.

### Controles Superiores:
- **Selector de Vista:** Toggle entre `Tablero Kanban` (recomendado para cocina) y `Tabla de Pedidos` (recomendado para caja y búsqueda histórica).
- **Filtros Rápidos:** `Todos`, `Nuevos (3)`, `En Cocina (5)`, `En Camino (2)`, `Entregados (28)`, `Cancelados (1)`.
- **Filtro de Tipo de Entrega:** `Todos`, `🛵 Delivery`, `🛍️ Retiro en local`.
- **Buscador Universal:** Búsqueda por número de orden (`#BS-1082`), nombre del cliente o teléfono.
- **Rango de Fechas:** Por defecto "Hoy" (con opciones: Ayer, Últimos 7 días, Personalizado).

### Estructura del Tablero Kanban:
4 Columnas con conteo y tiempo promedio de permanencia:
1. **Nuevos (Pendientes):**
   - Pedidos que acaban de ser confirmados por la IA en WhatsApp.
   - Botón primario: **"Pasar a Cocina"** (pasa el pedido a `in_kitchen`).
2. **En Preparación (Cocina):**
   - Pedidos en plancha, horno o empaque.
   - Temporizador visual que avanza (ej. `12 min en preparación`). Si supera los 25 min, el badge cambia a naranja/rojo.
   - Botón primario: **"Listo para Despacho"** (pasa a `out_for_delivery` o `ready_for_pickup`).
3. **En Camino / Listo en Local:**
   - Pedidos con repartidor asignado o listos en mostrador de tienda.
   - Botón primario: **"Marcar Entregado"** (pasa a `delivered`).
4. **Entregados / Completados:**
   - Pedidos cerrados exitosamente.

### Anatomía de la Tarjeta de Pedido (OrderCard):
- **Cabecera:** `#BS-1082` | Badge `Delivery` o `Retiro` | Hora `hace 6m`.
- **Cliente:** Nombre del cliente | Teléfono de WhatsApp (con icono para abrir chat).
- **Ítems Principales:** Viñetas legibles (ej. *2x Doble Queso Burger, 1x Papas Trufadas*).
- **Notas de Cocina:** Caja destacada en amarillo si el cliente puso notas especiales (*"Sin cebolla, salsas aparte"*).
- **Total y Pago:** `$22.50` | Badge `💳 Pagado contra entrega` o `✅ Pagado online`.
- **Acción Rápida:** Botón de avance de estado con un solo clic.

### Drawer / Modal de Detalle de Pedido:
Se abre al hacer clic sobre cualquier tarjeta o fila:
- Desglose formal de la orden: precios unitarios, extras, costo de delivery, subtotal, total.
- Datos de entrega: Dirección formateada, coordenadas, referencia para el motorizado, botón para abrir en Google Maps / Waze.
- Historial de eventos (Timeline con timestamp): Pedido creado por WhatsApp -> Pasado a cocina por Juan -> Despachado con repartidor Pedro -> Entregado.
- Botón **"Imprimir Comanda"**: Genera vista optimizada para impresora térmica de tickets (80mm / 58mm).
- Botón **"Cancelar Pedido"**: Modal destructivo que requiere seleccionar motivo (ej. cliente canceló, sin insumos, dirección inalcanzable).

---

## 3. Bandeja de Conversaciones en Vivo (`/conversations`)

Permite a los operadores supervisar las conversaciones que la IA mantiene en WhatsApp y tomar el control manual en tiempo real ante cualquier incidencia.

### Layout Maestro-Detalle (3 Paneles en Desktop, Pestañas en Mobile):

#### Panel 1: Lista de Conversaciones (Izquierda - 320px)
- **Buscador:** Filtrar por nombre del cliente, teléfono o palabra del chat.
- **Pestañas de Estado:**
  - `🚨 Por Atender (3)`: Conversaciones en `WAITING_HUMAN` (ordenadas por tiempo de espera).
  - `👨‍💼 Mis Chats (2)`: Conversaciones tomadas por el operador en sesión.
  - `🤖 Con IA (15)`: Conversaciones activas gestionadas automáticamente por el bot.
  - `📁 Todos / Resueltos`: Historial general.
- **Elemento de la lista:**
  - Avatar con iniciales o foto de perfil.
  - Nombre / Teléfono de WhatsApp.
  - Snippet del último mensaje recibido o enviado.
  - Tiempo transcurrido (ej. *"hace 2 min"*).
  - Badge de Estado: `🤖 IA Activa`, `🚨 Esperando Humano`, `👨‍💼 Operador`.
  - Contador de mensajes no leídos (badge verde).

#### Panel 2: Ventana de Chat en Vivo (Centro - Flexible)
- **Barra Superior del Chat:**
  - Datos del cliente activo.
  - Estado del control: `🤖 Asistente IA Activo` o `👨‍💼 Control Humano por Carlos M.`.
  - Botón de Acción Principal:
    - Si está con la IA: **"🚨 Tomar Control Manual"** (pausa la IA inmediatamente).
    - Si está en control humano: **"🤖 Devolver a IA"** (reanuda el asistente virtual).
    - Botón **"Marcar Resuelto"** (cierra el ticket de conversación).
- **Línea de Tiempo de Mensajes:**
  - Diferenciación visual de burbujas:
    - **Burbuja Izquierda (Gris/Blanca):** Mensajes recibidos del cliente de WhatsApp.
    - **Burbuja Derecha (Azul claro con icono 🤖):** Respuestas automáticas emitidas por la IA.
    - **Burbuja Derecha (Morada con icono 👨‍💼):** Mensajes enviados manualmente por un operador humano con su nombre.
    - **Caja Central (Amarilla con candado 🔒):** Nota interna de equipo (ej. *"El cliente llamó molesto porque su portero no abría"*). No se envía a WhatsApp.
- **Área de Envío de Mensaje:**
  - Input multilínea con soporte de enter para enviar.
  - Selector de **Respuestas Rápidas** (Canned responses: `/demora`, `/pago`, `/ubicacion`).
  - Toggle entre *"Enviar mensaje a cliente"* y *"Agregar nota interna"*.

#### Panel 3: Ficha Lateral del Cliente (Derecha - 280px, colapsable)
- Teléfono verificado de WhatsApp.
- Pedido activo en curso con acceso directo a la comanda.
- Historial de los últimos 3 pedidos completados.
- Dirección de entrega frecuente.
- Total acumulado de compras (LTV).

---

## 4. Gestión del Menú y Catálogo (`/menu`)

Diseñada para que el personal pueda actualizar la disponibilidad de insumos en segundos sin eliminar productos de la base de datos.

### Pantalla Principal de Menú:
- **Barra de Acciones:**
  - Selector de Categorías (Hamburguesas, Combos, Alitas, Acompañamientos, Bebidas, Postres).
  - Botón **"Gestionar Categorías"**.
  - Botón **"+ Nuevo Producto"**.
  - Buscador de productos.
- **Grid de Tarjetas de Producto (ProductCard):**
  - Imagen del plato.
  - Nombre del plato y precio de venta.
  - Descripción breve.
  - Modificadores vinculados (ej. *2 grupos de opciones*).
  - **Switch de Disponibilidad Inmediata (Stock Toggle):**
    - `🟢 Disponible`: La IA lo ofrece y permite agregarlo al carrito.
    - `🔴 Agotado / Oculto`: Si un cliente pide este producto en WhatsApp, la IA responderá según el Flujo F (Producto agotado) sugiriendo alternativas sin necesidad de editar la carta.
  - Botón de tres puntos: `Editar producto`, `Duplicar`, `Gestionar variantes`, `Desactivar temporalmente`.

### Modal de Creación / Edición de Producto:
- Campos:
  - Nombre del producto (ej. *"Burger Trufada"*).
  - Categoría asignada.
  - Precio base regular y precio promocional opcional.
  - Descripción sensorial para que la IA la utilice en WhatsApp (ej. *"Carne angus 180g con mayonesa de trufa negra y rúcula fresca"*).
  - Carga / URL de fotografía en alta resolución.
  - Grupos de opciones obligatorias y opcionales (ej. Término de carne, tamaño de papas, extras de queso).

---

## 5. Directorio de Clientes (`/customers`)

- Listado paginado de todos los números de teléfono que han interactuado con el agente.
- Columnas: Nombre, Número WhatsApp, Fecha de registro, Total pedidos completados, Monto total consumido, Última interacción.
- Drawer lateral al hacer clic:
  - Historial cronológico de pedidos.
  - Notas de servicio (ej. *"Prefiere sin cebolla en todas sus burgers"*, *"Dirección con timbre averiado"*).

---

## 6. Configuración del Agente IA (`/settings/agent`)

Permite a los administradores calibrar la conducta del asistente de WhatsApp sin escribir código ni modificar prompts crudos en el backend.

### Secciones Configurables:
1. **Estado Maestro:**
   - Switch de activación global de la IA. Si se desactiva, todas las conversaciones entran a la bandeja humana.
2. **Identidad del Asistente:**
   - Nombre público (ej. *"Max"*, *"Milo"*, *"ChefBot"*).
   - Tono de voz: Selector de presets (`Amigable y cercano`, `Formal y educado`, `Enérgico y juvenil`).
3. **Mensajes Predeterminados:**
   - Saludo inicial de bienvenida.
   - Mensaje de negocio cerrado / fuera de horario.
   - Mensaje de confirmación de pedido.
   - Mensaje de transferencia a operador humano.
4. **Reglas de Negocio para el Prompt del Sistema:**
   - Directivas comerciales adicionales (ej. *"Recomendar siempre agregar bebida y postre antes de confirmar"*).
   - Palabras clave que fuerzan transferencia a humano (ej. *"reclamo"*, *"denuncia"*, *"estafa"*, *"gerente"*).
   - Respuestas prohibidas / temas restringidos (ej. *"No hablar de política ni brindar recetas internas"*).
5. **Playground de Pruebas (Simulador Integrado):**
   - Mini-simulador de chat en la parte derecha de la pantalla que permite chatear con el bot con la configuración actual antes de publicarla a WhatsApp.

---

## 7. Configuración de Negocio y Delivery (`/settings/business`, `/settings/delivery`)

- **Datos de Negocio:** Nombre comercial, RUC/NIT, teléfono de soporte, moneda (\$ USD, S/, etc.), logo.
- **Horarios de Atención:** Matriz semanal lunes a domingo con posibilidad de doble turno (ej. Almuerzo 12:00-16:00 y Cena 19:00-23:00).
- **Zonas de Delivery:**
  - Modalidad de cálculo: Tarifa plana fija o por radio de distancia (km).
  - Radio máximo de atención (ej. 7 km desde la sucursal).
  - Costo de envío base y costo por km adicional.
  - Tiempo estimado estándar de cocina (ej. 20 min) y de despacho (ej. 20 min).

---

## 8. Métricas y Reportes Operativos (`/metrics`)

- Filtro de fecha: Hoy, Esta semana, Este mes.
- Gráficos claros y accionables:
  - **Ventas y pedidos por hora:** Curva de demanda para organizar la cantidad de cocineros por turno.
  - **Distribución de entregas:** Gráfico circular Delivery vs Retiro en local.
  - **Eficiencia del Agente IA:** Tasa de resolución autónoma (ej. 82% pedidos tomados por IA sin humano, 18% con asistencia).
  - **Tiempo promedio de entrega:** Desglose entre tiempo en cocina y tiempo de viaje del repartidor.
