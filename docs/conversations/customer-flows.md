# Flujos Conversacionales de WhatsApp — Agente IA para Restaurante

> **Versión:** 1.0.0 — Fase 1 (UX y Especificación Conversacional)
> **Responsable:** Antigravity (Product Designer / UX / Frontend)
> **Canal:** WhatsApp Business Cloud API
> **Regla de oro:** La IA nunca inventa precios, productos, disponibilidad ni tiempos de entrega. Todo dato operativo proviene del backend/base de datos vía contratos validados.

---

## 1. Principios de Interacción en WhatsApp

1. **Brevedad y Escaneabilidad:** Mensajes concisos (máximo 3-4 párrafos breves), uso de viñetas claras y espaciado limpio. WhatsApp se lee rápido en pantallas móviles.
2. **Emojis con Propósito:** Máximo 1 a 2 emojis por bloque temático (ej. 🍔 para comida, 📍 para ubicación, 🛵 para delivery, ⏱️ para tiempo). Nunca saturar.
3. **Llamadas a la Acción Claras (CTA):** Cada respuesta debe indicar claramente qué se espera del cliente a continuación.
4. **Idempotencia y Memoria de Sesión:** El carrito y el estado del pedido residen en el backend (Redis / Supabase), no en el prompt de la IA.
5. **Human Fallback Seguro:** Ante frustración, petición explícita o fallos reiterados, el bot transfiere inmediatamente sin insistir.

---

## 2. Máquina de Estados Conversacional

```
[INICIO / IDLE]
       │
       ├─────────────────────────► [CONSULTA_MENU / BUSQUEDA]
       │                                     │
       ├─────────────────────────► [CARRITO_ACTIVO] ◄───┐
       │                                     │          │ (Modificar / Agregar)
       ├─────────────────────────► [SELECCION_ENTREGA] ─┘
       │                                     │
       │                        ┌────────────┴────────────┐
       │                        ▼                         ▼
       │                  [RETIRO_LOCAL]           [DELIVERY_UBICACION]
       │                        │                         │
       │                        └────────────┬────────────┘
       │                                     ▼
       │                           [RESUMEN_CONFIRMACION]
       │                                     │
       │                        ┌────────────┴────────────┐
       │                        ▼                         ▼
       │                 [ORDEN_CREADA]            [CANCELACION]
       │                        │
       ├────────────────────────┴────────► [CONSULTA_ESTADO]
       │
       ├─────────────────────────────────► [HUMAN_HANDOFF]
       │
       └─────────────────────────────────► [FUERA_DE_HORARIO]
```

---

## 3. Matriz de Escenarios Conversacionales (A - W)

---

### A. Saludo inicial

- **Mensajes del cliente:** "Hola", "Buenas tardes", "Hola quiero pedir comida", "Menú por favor".
- **Intención:** `GREETING_START`
- **Acción del sistema:**
  1. Identifica el número de WhatsApp (cliente nuevo o recurrente).
  2. Verifica horario de atención en backend (`business_hours`).
  3. Si es cliente recurrente, recupera su nombre de pila registrado.
- **Respuesta del bot:**
  > "¡Hola Carlos! Bienvenido a **Burger Station** 🍔
  >
  > Estamos abiertos y listos para tomar tu pedido. ¿Qué te provoca hoy?
  >
  > 1️⃣ Ver el Menú completo
  > 2️⃣ Conocer las Promos del día
  > 3️⃣ Repetir mi último pedido
  > 4️⃣ Hablar con un asesor humano
  >
  > Escríbeme tu opción o cuéntame directo lo que deseas pedir."
- **Siguiente estado:** `IDLE_WAITING_CHOICE`
- **Posibles errores:** Fuera de horario (deriva a flujo U). Error de base de datos (responde saludo genérico sin nombre).

---

### B. Consulta del menú

- **Mensajes del cliente:** "Mándame el menú", "Quiero ver la carta", "1", "Qué tienen de comer".
- **Intención:** `MENU_BROWSE`
- **Acción del sistema:**
  1. Solicita al backend las categorías activas y productos destacados disponibles.
  2. Obtiene URL del menú web interactivo / PDF optimizado.
- **Respuesta del bot:**
  > "Aquí tienes nuestras categorías de hoy:
  >
  > 🍔 **Hamburguesas Artesanales** (desde \$6.50)
  > 🍟 **Acompañamientos y Snacks** (desde \$2.50)
  > 🥤 **Bebidas y Malteadas** (desde \$1.80)
  > 🍨 **Postres** (desde \$3.00)
  >
  > 📱 Puedes ver el menú con fotos aquí: *https://menu.burgerstation.com*
  >
  > O si prefieres, dime qué categoría te gustaría ver en detalle aquí mismo."
- **Siguiente estado:** `MENU_BROWSING`
- **Posibles errores:** Menú no disponible en backend (mensaje de disculpa y menú en texto de emergencia).

---

### C. Búsqueda de producto

- **Mensajes del cliente:** "¿Tienen opciones vegetarianas?", "¿Qué hamburguesas llevan tocino?", "¿Tienen alitas BBQ?".
- **Intención:** `PRODUCT_SEARCH`
- **Acción del sistema:**
  1. La IA extrae atributos clave (ej. `dietary=vegetarian` o `ingredient=tocino`).
  2. Consulta al catálogo filtrado por stock activo.
- **Respuesta del bot:**
  > "¡Sí! Para opciones vegetarianas tenemos:
  >
  > 🌱 **Green Burger**: Medallón de lentejas y champiñones, queso gouda vegano, lechuga y tomate — **\$7.20**
  > 🌱 **Falafel Bites (8 und)**: Croquetas crocantes con salsa tártara vegana — **\$4.00**
  >
  > ¿Deseas agregar alguna a tu pedido?"
- **Siguiente estado:** `PRODUCT_OFFERED`
- **Posibles errores:** Filtro sin coincidencias (deriva a flujo E).

---

### D. Consulta de precio

- **Mensajes del cliente:** "¿Cuánto cuesta la Doble Queso?", "¿Precio de la Burger Trufada?", "¿A cómo los tequeños?".
- **Intención:** `PRICE_QUERY`
- **Acción del sistema:**
  1. Identifica el producto exacto en el catálogo mediante match semántico/exacto.
  2. Consulta precio actual de venta y posibles combos asociados.
- **Respuesta del bot:**
  > "La **Burger Doble Queso** cuesta **\$8.50**.
  >
  > Incluye: doble carne 150g, doble queso cheddar fundido, cebolla caramelizada y salsa de la casa.
  > 🍟 ¿Te gustaría hacerla combo (papas + gaseosa) por **+\$2.50**?"
- **Siguiente estado:** `PRODUCT_UPSELL`
- **Posibles errores:** Varios productos coinciden (ej. "Doble Queso Sencilla" vs "Doble Queso Bacon"). El bot pregunta cuál de los dos prefiere.

---

### E. Producto no encontrado

- **Mensajes del cliente:** "¿Tienen sushi?", "¿Me das una pizza hawaiana?", "¿Venden ceviche?".
- **Intención:** `PRODUCT_NOT_FOUND`
- **Acción del sistema:**
  1. El catalog matcher reporta 0 resultados para el ítem consultado.
  2. Busca categorías más afines del restaurante (hamburguesas, sándwiches).
- **Respuesta del bot:**
  > "Disculpa, no contamos con *sushi* en nuestra carta. En **Burger Station** nos especializamos en hamburguesas artesanales, alitas y papas fritas.
  >
  > ¿Te gustaría revisar nuestras hamburguesas más pedidas o ver la carta completa?"
- **Siguiente estado:** `MENU_BROWSING`
- **Posibles errores:** Malentendido por regionalismos o errores ortográficos (el bot sugiere: "¿Te refieres a...?").

---

### F. Producto agotado

- **Mensajes del cliente:** "Quiero pedir la Mega Monster", "Agrega unos aros de cebolla".
- **Intención:** `PRODUCT_OUT_OF_STOCK`
- **Acción del sistema:**
  1. Match positivo del producto, pero el flag `is_available = false` o `stock = 0`.
  2. El backend devuelve sustitutos recomendados en la misma categoría.
- **Respuesta del bot:**
  > "¡Uy! La **Mega Monster** se agotó por el día de hoy debido a alta demanda 🙏.
  >
  > Te recomiendo probar la **Bacon BBQ Deluxe** (\$8.90), que tiene el mismo corte de carne y tocino crujiente, o la **Doble Smash** (\$8.20).
  >
  > ¿Te gustaría que agreguemos alguna de estas opciones?"
- **Siguiente estado:** `PRODUCT_SUBSTITUTION`
- **Posibles errores:** Cliente reitera que solo quería ese producto (se ofrece disculpa y aviso de stock futuro).

---

### G. Agregar producto al carrito

- **Mensajes del cliente:** "Quiero 2 Clásicas", "Ponme una bacon burger", "Agrégala".
- **Intención:** `CART_ADD_ITEM`
- **Acción del sistema:**
  1. Valida stock y disponibilidad.
  2. Revisa si el producto tiene opciones obligatorias (ej. término de la carne, tipo de queso, bebida del combo).
  3. Si no faltan opciones, crea o actualiza el carrito en base de datos.
- **Respuesta del bot (caso con opciones requeridas):**
  > "¡Perfecto! 1 **Bacon Burger** (\$8.00).
  >
  > Por favor elige el término de la carne:
  > 🥩 1. Tres cuartos (recomendado)
  > 🥩 2. Bien cocida
  >
  > ¿Deseas agregar papas fritas medianas por +\$1.50?"
- **Respuesta del bot (caso completo sin opciones pendientes):**
  > "✅ Agregado: **2x Clásica Burger** (\$13.00)
  >
  > 🛒 Tienes **2 productos** en tu carrito: Total parcial: **\$13.00**.
  >
  > ¿Deseas agregar algo más para picar o una bebida, o pasamos a la entrega?"
- **Siguiente estado:** `CART_BUILDING` o `CART_REVIEW`
- **Posibles errores:** Cantidad no especificada (asume 1 y confirma), número irreal (ej. 50 unidades, requiere confirmación o aviso al restaurante).

---

### H. Cambiar cantidad

- **Mensajes del cliente:** "Mejor que sean 3 clásicas, no 2", "Solo quiero una burger".
- **Intención:** `CART_UPDATE_QUANTITY`
- **Acción del sistema:**
  1. Identifica el ítem específico en el carrito del cliente.
  2. Actualiza la cantidad en el backend recalculando subtotales.
- **Respuesta del bot:**
  > "Listo, actualicé la cantidad 👍:
  >
  > 🍔 **3x Clásica Burger** — \$19.50
  >
  > Subtotal actual: **\$19.50**. ¿Deseas sumar algo más?"
- **Siguiente estado:** `CART_BUILDING`
- **Posibles errores:** El producto a modificar no existe en el carrito (se le muestra el carrito actual).

---

### I. Eliminar producto

- **Mensajes del cliente:** "Quita las alitas", "Ya no quiero la gaseosa", "Borra el último ítem".
- **Intención:** `CART_REMOVE_ITEM`
- **Acción del sistema:**
  1. Localiza el ítem en la lista activa del carrito.
  2. Ejecuta borrado lógico/físico en backend.
- **Respuesta del bot:**
  > "He eliminado **Alitas BBQ (6 und)** de tu pedido.
  >
  > Tu carrito ahora tiene:
  > • 1x Bacon Burger (\$8.00)
  > • 1x Papas Rústicas (\$2.50)
  >
  > Total: **\$10.50**. ¿Deseas continuar?"
- **Siguiente estado:** `CART_BUILDING`
- **Posibles errores:** Si el carrito queda vacío, responde: "Tu carrito ahora está vacío. ¿Qué se te antoja ordenar?".

---

### J. Añadir observaciones

- **Mensajes del cliente:** "La hamburguesa sin cebolla ni mayonesa", "Salsa picante aparte por favor", "Carne bien asada".
- **Intención:** `CART_ADD_NOTES`
- **Acción del sistema:**
  1. Asocia la nota al ítem específico del carrito (o nota general del pedido).
  2. Guarda `customer_notes` en backend.
- **Respuesta del bot:**
  > "Anotado en cocina 👨‍🍳:
  > ✍️ *'Sin cebolla ni mayonesa, salsa picante aparte'*.
  >
  > ¿Alguna otra instrucción especial o procedemos con tu dirección de entrega?"
- **Siguiente estado:** `CART_BUILDING`
- **Posibles errores:** Observaciones que implican cobro adicional (ej. "agrégale doble carne extra"); el bot detecta el extra y aclara el costo adicional antes de confirmar.

---

### K. Ver carrito

- **Mensajes del cliente:** "Qué tengo pedido", "Muéstrame el carrito", "Cuánto voy", "Resumen".
- **Intención:** `CART_VIEW`
- **Acción del sistema:**
  1. Consulta backend para obtener ítems, precios unitarios, notas y subtotal.
- **Respuesta del bot:**
  > "📋 **Tu Carrito Actual:**
  >
  > 1️⃣ 2x Clásica Burger — \$13.00
  > ↳ *Término 3/4, sin pepinillos*
  > 2️⃣ 1x Papas Rústicas con Queso — \$3.50
  > 3️⃣ 2x Coca-Cola Zero 500ml — \$3.60
  >
  > ────────────────
  > 💰 **Subtotal:** \$20.10
  > *(Costo de delivery se calcula según tu dirección).*
  >
  > ¿Deseas:
  > 🛵 **1. Pedir a Domicilio**
  > 🛍️ **2. Retirar en el Local**
  > ➕ **3. Seguir agregando**"
- **Siguiente estado:** `CART_SELECTION_FULFILLMENT`
- **Posibles errores:** Carrito vacío.

---

### L. Pedido para retiro en local

- **Mensajes del cliente:** "Paso a recoger", "Retiro en local", "Para llevar", "Opción 2".
- **Intención:** `ORDER_PICKUP`
- **Acción del sistema:**
  1. Fija `fulfillment_type = 'pickup'`.
  2. Costo de delivery = \$0.00.
  3. Recupera dirección de la sucursal y tiempo estimado de cocina.
- **Respuesta del bot:**
  > "Excelente, prepararás tu retiro en nuestro local:
  > 📍 **Av. Principal 123, Miraflores**
  > ⏱️ Tiempo estimado: **20-25 minutos**.
  >
  > ¿A nombre de quién registramos el pedido y tu número de contacto?"
- **Siguiente estado:** `CHECKOUT_PICKUP_DETAILS`
- **Posibles errores:** Sucursal cerrada para retiro.

---

### M. Pedido a domicilio

- **Mensajes del cliente:** "Quiero delivery", "A domicilio", "Envíamelo a casa", "Opción 1".
- **Intención:** `ORDER_DELIVERY`
- **Acción del sistema:**
  1. Fija `fulfillment_type = 'delivery'`.
  2. Verifica disponibilidad de repartidores / radio de cobertura.
- **Respuesta del bot:**
  > "¡Listo para delivery! 🛵
  >
  > Por favor comparte tu **ubicación actual por WhatsApp** 📎 o escríbeme tu dirección exacta (Calle, Número, Edificio/Piso y Referencia)."
- **Siguiente estado:** `AWAITING_ADDRESS`
- **Posibles errores:** Lluvia extrema o flota llena (aviso de retraso preventivo).

---

### N. Solicitud de ubicación

- **Mensajes del cliente:** Envío de ubicación de WhatsApp (latitud/longitud) o texto: "Calle Los Sauces 450, dpto 302, frente al parque".
- **Intención:** `PROVIDE_LOCATION`
- **Acción del sistema:**
  1. Recibe coordenadas o geocodifica el texto con backend.
  2. Verifica si el punto está dentro de las zonas de reparto (`delivery_zones`).
  3. Calcula la tarifa de envío correspondiente.
- **Respuesta del bot (dentro de cobertura):**
  > "📍 Dirección recibida: **Calle Los Sauces 450, dpto 302**
  > 🛵 Costo de envío: **\$2.00**
  > ⏱️ Tiempo estimado de entrega: **35-45 minutos**
  >
  > ¿Alguna referencia para el repartidor? (ej. timbre, portón negro, dejar en recepción)."
- **Siguiente estado:** `ADDRESS_CONFIRMED`
- **Posibles errores:** Coordenadas erróneas o dirección ambigua (el bot pide número municipal o calle transversal).

---

### O. Dirección fuera de cobertura

- **Mensajes del cliente:** Envío de ubicación distante (ej. a 25 km fuera del radio).
- **Intención:** `LOCATION_OUT_OF_BOUNDS`
- **Acción del sistema:**
  1. El backend evalúa la zona y devuelve `is_in_coverage = false`.
- **Respuesta del bot:**
  > "Lo sentimos mucho 😔. Por el momento tu dirección está fuera de nuestra zona de cobertura para delivery directo (nuestro radio llega hasta 7 km).
  >
  > Pero tenemos dos alternativas:
  > 1️⃣ Puedes **recoger tu pedido en local** (Av. Principal 123) y te lo tenemos listo en 20 min.
  > 2️⃣ Enviar tu propio repartidor / courier (Rappi Favores, Uber Flash, etc.).
  >
  > ¿Te gustaría cambiar a Retiro en Local?"
- **Siguiente estado:** `OUT_OF_COVERAGE_RESOLUTION`
- **Posibles errores:** Cliente insiste (se le ofrece transferir con un encargado para cotización especial).

---

### P. Confirmación del pedido

- **Mensajes del cliente:** "Sí, confirmo", "Todo correcto", "Proceder", "Pedir".
- **Intención:** `ORDER_CONFIRM`
- **Acción del sistema:**
  1. Muestra el resumen consolidado final con montos discriminados.
  2. Solicita el método de pago previsto (Efectivo / Transferencia / Tarjeta contra entrega).
  3. Al confirmar el pago, genera la orden con estado `PENDING` (o `AWAITING_PAYMENT_PROOF`) y código único (ej. `#BS-1082`).
  4. Dispara notificación al Panel de Pedidos de Cocina.
- **Respuesta del bot:**
  > "🎉 ¡Pedido confirmado con éxito!
  >
  > 🔖 **Pedido #BS-1082**
  > ────────────────
  > • 2x Clásica Burger
  > • 1x Papas Rústicas
  > • 2x Bebidas
  > 🛵 Envío: \$2.00
  > 💰 **Total a pagar:** **\$22.10**
  > 💳 Método: Pago con tarjeta contra entrega
  > 📍 Entrega en: Calle Los Sauces 450, dpto 302
  > ⏱️ Tiempo estimado: **35-45 minutos**
  >
  > Puedes consultar el estado de tu orden en cualquier momento escribiendo *'estado'*. ¡Muchas gracias por tu compra!"
- **Siguiente estado:** `ORDER_PLACED`
- **Posibles errores:** Falla de red en webhook/DB (se informa que se está procesando y no se cobra doble).

---

### Q. Cliente cambia de opinión antes de confirmar

- **Mensajes del cliente:** "Espera, no", "Quiero cambiar una hamburguesa", "Mejor no pidas todavía", "Quiero agregar algo más".
- **Intención:** `ORDER_ABORT_CONFIRMATION`
- **Acción del sistema:**
  1. No crea la orden definitiva.
  2. Mantiene el carrito intacto y retrocede al estado de edición.
- **Respuesta del bot:**
  > "Sin problema, aún no hemos enviado el pedido a cocina 👍.
  >
  > ¿Qué te gustaría modificar o agregar?"
- **Siguiente estado:** `CART_BUILDING`
- **Posibles errores:** Confusión si el cliente solo quería cambiar el método de pago (se atiende con flexibilidad).

---

### R. Cliente consulta estado del pedido

- **Mensajes del cliente:** "¿Cómo va mi pedido?", "¿Por dónde viene el repartidor?", "Estado #BS-1082", "Ya se demoró".
- **Intención:** `ORDER_STATUS_QUERY`
- **Acción del sistema:**
  1. Busca la última orden activa asociada al teléfono del remitente.
  2. Consulta estado en backend (`pending`, `confirmed`, `in_kitchen`, `out_for_delivery`, `delivered`).
- **Respuesta del bot:**
  > "Tu pedido **#BS-1082** está:
  > 👨‍🍳 **En Cocina / Preparación**.
  >
  > Salió del horno hace 5 minutos y se está empaquetando. En aprox. 15 minutos nuestro repartidor saldrá hacia tu dirección. Te avisaremos apenas vaya en camino 🛵."
- **Siguiente estado:** `ORDER_TRACKING`
- **Posibles errores:** No hay pedidos activos para ese número (pregunta por el número de ticket).

---

### S. Cliente solicita humano

- **Mensajes del cliente:** "Quiero hablar con una persona", "Pásame con alguien", "Humano por favor", "Asesor".
- **Intención:** `HUMAN_HANDOFF_REQUEST`
- **Acción del sistema:**
  1. Cambia el estado de la conversación en backend a `WAITING_HUMAN`.
  2. Pausa las respuestas automáticas de la IA para este usuario.
  3. Emite alerta sonora y visual en el Panel Administrativo (Bandeja de Conversaciones).
- **Respuesta del bot:**
  > "Entendido, te estoy comunicando con un compañero de nuestro equipo de atención humana 👨‍💼.
  >
  > He pausado el asistente automático. Un asesor leerá tu conversación y te responderá por aquí en unos minutos. ¡Gracias por tu paciencia!"
- **Siguiente estado:** `HANDOFF_ACTIVE`
- **Posibles errores:** Fuera de horario de personal (se notifica que el personal responderá a primera hora).

---

### T. IA no entiende

- **Mensajes del cliente:** Mensajes incomprensibles, audios con ruido ininteligible, stickers sin contexto, textos inconexos.
- **Intención:** `FALLBACK_UNKNOWN`
- **Acción del sistema:**
  1. Contador de fallbacks consecutivos (`fallback_count`).
  2. Si `fallback_count == 1`, repregunta con opciones guiadas.
  3. Si `fallback_count >= 2`, ofrece transferencia automática a humano.
- **Respuesta del bot (primer intento):**
  > "Disculpa, no logré entender tu mensaje 🤔.
  >
  > ¿Deseas ver el **Menú**, consultar el **Estado de tu pedido** o prefieres que te atienda un **Asesor humano**?"
- **Respuesta del bot (segundo intento consecutivo):**
  > "Parece que estoy teniendo dificultades para comprenderte bien. Para no hacerte esperar, ¿deseas que te transfiera ahora mismo con una persona de nuestro equipo?"
- **Siguiente estado:** `FALLBACK_PROMPT` o `HANDOFF_ACTIVE`
- **Posibles errores:** Bucle infinito de respuestas automáticas (se evita con el contador estricto).

---

### U. Negocio cerrado

- **Mensajes del cliente:** Cliente escribe a las 3:00 AM (fuera de horario comercial).
- **Intención:** `BUSINESS_CLOSED`
- **Acción del sistema:**
  1. Backend evalúa `business_hours` de la fecha/hora actual.
- **Respuesta del bot:**
  > "¡Hola! Gracias por escribir a **Burger Station** 🌙.
  >
  > En este momento nos encontramos descansando. Nuestro horario de atención es:
  > 🕒 **Lunes a Domingo de 12:00 PM a 11:00 PM**
  >
  > Puedes dejarnos tu mensaje o revisar nuestro menú para mañana aquí: *https://menu.burgerstation.com*. ¡Estaremos felices de atenderte apenas abramos!"
- **Siguiente estado:** `IDLE_CLOSED`
- **Posibles errores:** Clientes que quieren programar pedidos para el día siguiente (futura funcionalidad).

---

### V. Cancelación

- **Mensajes del cliente:** "Quiero cancelar mi pedido", "Ya no quiero nada", "Cancela el #BS-1082".
- **Intención:** `ORDER_CANCEL`
- **Acción del sistema:**
  1. Verifica el estado actual del pedido en backend.
  2. Si el pedido está en `pending` (aún no entra a freidora/plancha), se permite cancelación automática.
  3. Si el pedido está en `in_kitchen` o `out_for_delivery`, NO se cancela automáticamente por IA: se pasa a humano con etiqueta de urgencia.
- **Respuesta del bot (en cocina / en reparto):**
  > "Tu pedido **#BS-1082** ya se encuentra en preparación en cocina 👨‍🍳.
  >
  > Para solicitar una anulación en este punto, te transfiero de inmediato con el supervisor de turno para que evalúe tu caso. Un momento por favor."
- **Siguiente estado:** `HANDOFF_URGENT_CANCEL`
- **Posibles errores:** Intento de cancelación maliciosa después de entregado.

---

### W. Error del sistema

- **Mensajes del cliente:** Cualquier solicitud mientras la base de datos o servicio externo sufre timeout/caída.
- **Intención:** `SYSTEM_ERROR`
- **Acción del sistema:**
  1. Manejador global de excepciones captura el error sin revelar trazas técnicas.
  2. Registra logs en backend con requestId.
  3. Mantiene el canal abierto sin bloquear al usuario.
- **Respuesta del bot:**
  > "Tuvimos un pequeño inconveniente técnico momentáneo al consultar el sistema 🛠️.
  >
  > Por favor intenta reenviar tu mensaje en 1 minuto, o si es urgente, llama directamente a nuestro local al 📞 **+51 987 654 321**."
- **Siguiente estado:** `RETRY_STATE`
- **Posibles errores:** Webhook caído; Meta reintenta automáticamente con backoff exponencial.
