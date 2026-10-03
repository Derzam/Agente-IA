# Arquitectura de Información y Modelo de Usuarios — Panel Administrativo

> **Versión:** 1.0.0 — Fase 1
> **Área:** UX/UI & Product Design
> **Proyecto:** Agente de IA para WhatsApp de Restaurante

---

## 1. Definición de Arquetipos de Usuario (User Personas)

### A. Cliente del Restaurante (Consumidor WhatsApp)
- **Canal de interacción:** WhatsApp (Smartphone personal).
- **Contexto:** Persona con hambre, apuro o tiempo limitado. Puede estar en la oficina, en casa o de camino al local.
- **Objetivos:**
  - Encontrar rápidamente qué comer sin rodeos.
  - Conocer precios y promociones reales sin tener que llamar.
  - Personalizar su pedido (sin cebolla, salsa aparte, combo con papas).
  - Saber exactamente cuánto pagará y en cuánto tiempo llegará su comida.
  - Si algo sale mal o tiene una pregunta especial, ser atendido por una persona sin trabas.
- **Puntos de dolor:** Mensajes excesivamente largos, bots que repiten la misma respuesta, precios desactualizados, falta de confirmación de su pedido.

---

### B. Personal del Restaurante (Cocina, Despacho y Operador de Caja)
- **Canal de interacción:** Tablet en cocina/mostrador (10"-12") o laptop en caja.
- **Contexto:** Ritmo de trabajo frenético durante horas punta (almuerzo 12:30-15:00, cena 19:30-22:30). Manos frecuentemente ocupadas, ruido ambiental, necesidad de tomar decisiones en menos de 3 segundos.
- **Objetivos:**
  - Ver nuevos pedidos confirmados al instante sin necesidad de recargar la página.
  - Aceptar y pasar pedidos a cocina con un solo toque (touch-friendly grande).
  - Imprimir comandas para cocina y tickets de despacho.
  - Detectar de inmediato si un cliente en WhatsApp solicitó atención humana y responderle con rapidez.
  - Pausar temporalmente productos agotados para que la IA no los siga ofreciendo.
- **Puntos de dolor:** Pantallas con texto diminuto, flujos con demasiados clics, alertas invisibles o silenciosas, desincronización entre lo que ve el bot y lo que hay en cocina.

---

### C. Administrador / Dueño del Negocio
- **Canal de interacción:** Laptop/Escritorio (90%) y Smartphone (10% para chequeos rápidos fuera del local).
- **Contexto:** Gestión estratégica, control de costos, configuración del negocio, supervision de rendimiento.
- **Objetivos:**
  - Configurar horarios de apertura y cierre, días festivos y excepciones.
  - Ajustar zonas y tarifas de delivery.
  - Personalizar el tono, nombre y reglas del asistente virtual de WhatsApp.
  - Administrar el catálogo de productos, categorías, precios y fotos.
  - Gestionar el equipo de empleados con diferentes niveles de acceso.
  - Analizar métricas de ventas, ticket promedio, efectividad del bot y cuellos de botella.
- **Puntos de dolor:** Complejidad técnica excesiva, depender de programadores para cambiar un precio o un horario, falta de visibilidad sobre si el bot comete errores.

---

## 2. Matriz de Permisos y Roles (RBAC)

| Módulo / Funcionalidad | Operador (Caja/Atención) | Cocinero / Despacho | Administrador / Dueño |
|---|:---:|:---:|:---:|
| **Dashboard Operativo** | Lectura | Lectura | Total |
| **Gestión de Pedidos** | Crear / Modificar / Cancelar | Ver / Cambiar Estado Cocina | Total |
| **Impresión de Comandas** | Sí | Sí | Sí |
| **Bandeja de Conversaciones (Chat)** | Atender / Responder / Devolver a IA | Solo Lectura | Total |
| **Menú: Ver Catálogo** | Sí | Sí | Sí |
| **Menú: Activar/Desactivar Stock** | Sí (Rápido) | Sí (Rápido) | Sí |
| **Menú: Modificar Precios/Crear Platos** | No | No | Sí |
| **Directorio de Clientes** | Ver datos de contacto del pedido | No | Total |
| **Configuración del Agente IA** | No | No | Sí |
| **Configuración de Negocio / Horarios** | No | No | Sí |
| **Zonas de Delivery y Tarifas** | No | No | Sí |
| **Gestión de Usuarios y Roles** | No | No | Sí |
| **Reportes Financieros y Métricas** | No | No | Total |

---

## 3. Arquitectura de Información (Mapa del Sitio)

```
[PANEL ADMINISTRATIVO]
  │
  ├── 📊 Dashboard (/dashboard)
  │     ├── Métricas del Día (Ventas, Pedidos, Ticket promedio)
  │     ├── Resumen de Cocina (Nuevos, En Preparación, Despachados)
  │     ├── Alertas Urgentes (Conversaciones en espera humana)
  │     └── Productos Estrella de la jornada
  │
  ├── 📦 Pedidos (/orders)
  │     ├── Vista Kanban (Columnas: Nuevos -> En Cocina -> En Camino -> Entregados)
  │     ├── Vista Tabla (Lista paginada con filtros rápidos y búsqueda)
  │     ├── Drawer / Modal de Detalle de Pedido
  │     ├── Cambio de Estado con 1 clic
  │     ├── Historial de Cambios y Notas internas
  │     └── Impresión de Comanda / Ticket
  │
  ├── 💬 Conversaciones (/conversations)
  │     ├── Lista de Conversaciones (Pestañas: Por Atender, Atendiendo, Todos)
  │     ├── Panel de Chat WhatsApp en Vivo (Burbujas Cliente / Bot / Humano)
  │     ├── Switch de Control Operativo (Tomar Control / Devolver a IA)
  │     ├── Respuestas Rápidas (Canned responses)
  │     ├── Notas Internas del Staff
  │     └── Ficha Lateral del Cliente (Historial, pedidos activos)
  │
  ├── 🍽️ Menú (/menu)
  │     ├── Categorías (Crear, ordenar, activar/desactivar)
  │     ├── Productos (Búsqueda, filtro por categoría, filtro por stock)
  │     ├── Switch instantáneo de Disponibilidad (In-stock / Out-of-stock)
  │     ├── Modal de Creación / Edición de Producto
  │     └── Grupos de Modificadores (Extras, Variantes, Términos)
  │
  ├── 👥 Clientes (/customers)
  │     ├── Listado de clientes registrados vía WhatsApp
  │     ├── Búsqueda por Teléfono o Nombre
  │     ├── Métricas de recurrencia (Total gastado, Pedidos realizados, Último pedido)
  │     └── Notas de servicio (Cliente frecuente, alérgico a nueces, etc.)
  │
  ├── 📈 Métricas (/metrics)
  │     ├── Ventas por franja horaria (identificación de horas pico)
  │     ├── Canales de entrega (Delivery vs Retiro en local)
  │     ├── Desempeño del Agente IA (Tasa de autoservicio vs Handoff)
  │     └── Tiempos promedio de preparación y entrega
  │
  └── ⚙️ Configuración (/settings)
        ├── 🏪 Negocio (Nombre, teléfono de contacto, dirección física, moneda)
        ├── 🕒 Horarios (Horario semanal por turnos, festivos, cierre de emergencia)
        ├── 🛵 Delivery (Zonas de reparto, tarifas fijas o por radio, radio máximo)
        ├── 🤖 Agente IA (Nombre del bot, saludo, tono, mensajes fuera de horario, reglas)
        ├── 📲 WhatsApp API (Estado de conexión, número ID, webhook status)
        └── 🛡️ Equipo y Roles (Invitaciones, usuarios activos, asignación de permisos)
```

---

## 4. Estrategia de Navegación y Layout Responsive

### Breakpoints Definidos:
- **Mobile (< 768px):** Teléfonos inteligentes (uso esporádico por dueños o repartidores).
  - Navegación mediante Bottom Navigation Bar fija o Hamburguesa Drawer.
  - Tablas se transforman en tarjetas apiladas verticales (Card Layout).
  - Vistas de chat y detalle de pedido ocupan pantalla completa con botón "Atrás".
- **Tablet (768px - 1024px):** Dispositivos de cocina / comandero táctil.
  - Sidebar compacto colapsable con iconos legibles.
  - Botones con área de contacto mínima de **48x48px** para interacción táctil con un dedo.
  - En Kanban: 2 o 3 columnas visibles con scroll horizontal suave.
- **Desktop (> 1024px):** Estaciones de caja y administración.
  - Sidebar permanente expandido con etiquetas claras y badges de alerta en vivo.
  - Master-detail split screens (ej. Lista de chats al lado izquierdo, panel de conversación y ficha de cliente en el centro y derecha).
  - Soporte de atajos de teclado para operaciones comunes (ej. `Ctrl+K` para buscar pedidos, `Esc` para cerrar modales).
