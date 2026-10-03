# Sistema de Diseño y Guía de Componentes — Panel Administrativo

> **Versión:** 1.0.0 — Fase 1
> **Área:** UI/UX & Frontend Architecture
> **Estándar:** WCAG 2.1 Nivel AA
> **Stack Base:** Tailwind CSS + Radix UI Primitives / Lucide Icons

---

## 1. Tokens de Diseño y Paleta de Color

La identidad visual combina tonos cálidos y gastronómicos (ámbar, naranja, carbón) con una estética de software moderno de alta legibilidad y bajo cansancio visual en turnos prolongados de trabajo.

### Paleta Semántica:

| Token | Hex | Tailwind Class | Uso Principal |
|---|---|---|---|
| **Primary (Brand)** | `#EA580C` | `orange-600` | Acciones principales, botones destacados, acentos de marca. |
| **Primary Hover** | `#C2410C` | `orange-700` | Estado hover de botones primarios. |
| **Primary Light** | `#FFF7ED` | `orange-50` | Fondos de selección activa, badges suaves de pedidos. |
| **Dark Neutral (Surface)** | `#0F172A` | `slate-900` | Sidebar, textos principales, encabezados. |
| **Surface Card** | `#FFFFFF` | `white` | Tarjetas de pedidos, modales, paneles de chat. |
| **Background App** | `#F8FAFC` | `slate-50` | Fondo general de la aplicación. |
| **Border Neutral** | `#E2E8F0` | `slate-200` | Líneas divisorias, bordes de tablas y tarjetas. |
| **Text Primary** | `#0F172A` | `slate-900` | Títulos, precios, nombres de clientes. |
| **Text Secondary** | `#64748B` | `slate-500` | Metadatos, horas transcurridas, subtítulos. |

### Colores de Estado Operativo:

| Estado | Token | Clases (Texto / Fondo) | Aplicación |
|---|---|---|---|
| **Nuevo / Pendiente** | Amber | `text-amber-700 bg-amber-50 border-amber-200` | Pedido recién creado por WhatsApp. |
| **En Cocina** | Blue | `text-blue-700 bg-blue-50 border-blue-200` | Pedido en preparación en plancha. |
| **En Camino / Listo** | Indigo | `text-indigo-700 bg-indigo-50 border-indigo-200` | Repartidor en ruta o listo en mostrador. |
| **Completado / Entregado**| Green | `text-emerald-700 bg-emerald-50 border-emerald-200` | Pedido cerrado y pagado. |
| **Cancelado / Rechazado** | Rose | `text-rose-700 bg-rose-50 border-rose-200` | Pedido anulado. |
| **Agente IA (Bot)** | Cyan / Sky | `text-sky-700 bg-sky-50 border-sky-200` | Badge de asistente virtual y respuestas del bot. |
| **Esperando Humano** | Red Alert | `text-red-700 bg-red-50 border-red-300 animate-pulse` | Alerta urgente de cliente en espera de operador. |
| **Operador Humano** | Purple | `text-purple-700 bg-purple-50 border-purple-200` | Mensajes y asignación de empleados de soporte. |

---

## 2. Tipografía y Escala de Texto

Familia de fuente recomendada: **Inter** o `system-ui` (sans-serif moderno de excelente renderizado en pantallas táctiles y Retina).

- **Display (H1):** `text-2xl font-bold tracking-tight` (24px) — Títulos de sección principal (Dashboard, Pedidos).
- **Subheader (H2):** `text-lg font-semibold` (18px) — Títulos de tarjetas y modales.
- **Section Title (H3):** `text-base font-semibold` (16px) — Nombres de platos, subtítulos de columnas.
- **Body Regular:** `text-sm font-normal leading-relaxed` (14px) — Texto general, notas de clientes.
- **Body Bold / Metric:** `text-sm font-semibold` (14px) — Precios, teléfonos, números de orden.
- **Caption / Meta:** `text-xs font-medium text-slate-500` (12px) — Tiempos relativos (*"hace 5 min"*), badges secundarios.

---

## 3. Accesibilidad y Estándares WCAG 2.1 AA

1. **Contraste de Color:**
   - Todos los textos de contenido principal superan la relación de contraste **4.5:1** contra el fondo blanco o gris.
   - Textos de badges de estado utilizan combinaciones validadas (ej. texto oscuro sobre fondo pastel con borde complementario).
2. **Independencia del Color:**
   - Ningún estado se comunica exclusivamente por color.
   - Cada badge incluye un icono semántico y una etiqueta textual explícita (ej. 🟢 `Listo para entrega`, 🚨 `Esperando asesor`).
3. **Áreas de Toque Táctiles (Touch Targets):**
   - En tablets de cocina y móviles, todos los botones de avance de estado y conmutadores tienen dimensiones mínimas de **44 x 44 px** (recomendado **48 x 48 px** para cocina).
4. **Navegación por Teclado y Estados de Foco:**
   - Enlaces y botones interactivos poseen anillos de foco visibles (`focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2`).
   - Los modales implementan focus trap y cierre con tecla `Escape`.
5. **Lectores de Pantalla:**
   - Los botones con solo iconos incluyen atributo `aria-label` descriptivo (ej. `aria-label="Imprimir comanda de cocina"`).
   - Las alertas urgentes de handoff utilizan regiones `aria-live="polite"` para anunciar la llegada de un cliente en espera.

---

## 4. Inventario de Componentes Base

```
[CORE ATOMS]
  ├── Button (Primary, Secondary, Outline, Ghost, Danger)
  ├── Badge / StatusBadge (Variantes operativas de Pedido y Chat)
  ├── Input / Textarea / SearchInput
  ├── Switch (Toggle para disponibilidad de stock y activación de IA)
  └── DropdownMenu / Select

[MOLECULES]
  ├── PageHeader (Título, breadcrumbs, descripción y acciones de página)
  ├── MetricCard (KPI con valor, variación, icono e indicador de tendencia)
  ├── FilterBar (Buscador integrado + pills de filtro rápido)
  ├── EmptyState (Icono ilustrativo, título, descripción y botón CTA)
  ├── ErrorState (Banner de error con botón de reintento)
  └── Toast (Notificaciones emergentes de éxito/error con auto-cierre)

[ORGANISMS]
  ├── Sidebar & Topbar (Navegación principal responsive con badges de alerta)
  ├── OrderCard (Tarjeta de pedido para vista Kanban con avance rápido)
  ├── OrderTable (Tabla de pedidos con ordenamiento y paginación)
  ├── OrderDrawer (Detalle completo de orden, desglose y acciones)
  ├── ConversationList (Listado maestro de chats con filtros de atención)
  ├── ChatPanel (Ventana de chat en vivo con burbujas tipificadas y takeover)
  ├── ProductCard (Tarjeta de menú con switch de stock instantáneo)
  ├── ProductFormModal (Formulario para crear/editar productos y variantes)
  └── ConfirmDialog (Modal de confirmación para acciones destructivas)
```

---

## 5. Especificación de Estados de Interfaz (UI States)

### A. Estado de Carga (Loading / Skeleton)
- Se evitan spinners centrales bloqueantes de pantalla completa.
- Se utilizan **Skeleton Placeholders** grises con animación de pulso que imitan la forma del contenido real (tarjetas de pedidos, filas de tabla y burbujas de chat).

### B. Estado Vacío (Empty State)
- Si una pestaña no tiene datos (ej. *"No hay pedidos en preparación"* o *"No hay chats esperando atención"*):
  - Icono visual relajante (ej. check verde o bandeja limpia).
  - Título positivo: *"¡Todo en orden!"*.
  - Explicación breve: *"No tienes pedidos pendientes en cocina en este momento."*.

### C. Estado de Error (Error State)
- Si falla una llamada a la API:
  - Alerta no invasiva pero clara.
  - Mensaje comprensible en español humano (evitando errores crudos como `Failed to fetch 500`).
  - Botón de acción: **"Reintentar conexión"**.

### D. Estado Fuera de Línea (Offline)
- Banner superior amarillo/naranja discreto: *"Sin conexión a internet. Los cambios se sincronizarán al reconectar."*.

### E. Diálogos de Confirmación Destructiva (ConfirmDialog)
- Para cancelar un pedido, eliminar un producto o pausar la IA:
  - Modal centrado con backdrop opaco.
  - Título en rojo/ámbar: *"¿Seguro que deseas cancelar el pedido #BS-1082?"*.
  - Campo obligatorio de motivo de anulación.
  - Botón de confirmación con estilo destructivo (Rojo) y botón Cancelar neutral.
