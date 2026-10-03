# Protocolo de Transferencia a Atención Humana (Human Handoff)

> **Versión:** 1.0.0 — Fase 1 (UX y Especificación)
> **Área:** Experiencia Conversacional & Panel de Control
> **Objetivo:** Definir las reglas, estados y experiencia de usuario cuando una conversación pasa del Agente de IA al personal del restaurante y viceversa.

---

## 1. Justificación y Objetivos de UX

La automatización mediante IA en un negocio gastronómico resuelve el 80% de consultas repetitivas (menú, horarios, armado de pedidos estándar). Sin embargo, la experiencia de marca puede destruirse si un cliente con una duda compleja, una queja o una necesidad especial queda atrapado en un bucle automatizado.

**Objetivos clave:**
1. **Transición sin fricción:** El cliente nunca debe sentir que el sistema "se niega" a ayudarlo.
2. **Pausa inmediata y confiable:** Una vez activado el traspaso, la IA no debe volver a contestar por error hasta que el operador lo indique.
3. **Visibilidad operativa:** El personal en el panel debe ver inmediatamente qué clientes necesitan ayuda, por qué motivo y cuál es el historial previo.
4. **Retorno elegante al bot:** El personal puede resolver la duda puntual y devolver la conversación a la IA para que el cliente continúe su pedido.

---

## 2. Disparadores de Transferencia (Handoff Triggers)

| Disparador | Tipo | Criterio / Regla | Prioridad |
|---|---|---|---|
| **Petición explícita del cliente** | Explícito | Palabras clave: *"humano"*, *"persona"*, *"asesor"*, *"supervisor"*, *"hablar con alguien"* o seleccionar opción 4 del menú. | Normal |
| **Fallbacks consecutivos** | Automático | 2 respuestas consecutivas del cliente clasificadas con intención `FALLBACK_UNKNOWN` o baja confianza (< 0.65). | Media |
| **Detección de frustración / queja** | Automático | Análisis de sentimiento negativo (insultos, reclamos de pedidos previos, *"mi pedido llegó frío"*, *"falta comida"*). | Alta (Urgente) |
| **Intento de cancelación en cocina** | Operativo | Cliente solicita cancelar cuando el pedido ya está en estado `in_kitchen` o `out_for_delivery`. | Alta |
| **Discrepancia en pago / comprobante** | Operativo | El cliente envía un comprobante de transferencia bancaria que requiere validación humana obligatoria. | Normal |
| **Excepción de delivery** | Operativo | Dirección ligeramente fuera de zona pero el cliente desea cotizar un envío especial con courier externo. | Baja |
| **Toma de control manual proactiva** | Manual | Un operador en el panel decide intervenir voluntariamente en cualquier momento. | Variable |

---

## 3. Máquina de Estados de la Conversación

```
                     ┌────────────────────────────────────────┐
                     │                                        │
                     ▼                                        │
             ┌───────────────┐                                │
             │  BOT_ACTIVE   │                                │
             └───────┬───────┘                                │
                     │ Disparador de Handoff                  │
                     ▼                                        │
             ┌───────────────┐                                │
             │ WAITING_HUMAN │ (Alerta visual y sonora en UI) │
             └───────┬───────┘                                │
                     │ Operador hace clic en "Atender"        │
                     ▼                                        │
             ┌───────────────┐                                │
             │ HUMAN_ACTIVE  │ (IA pausada, operador chatea)  │
             └───────┬───────┘                                │
                     │                                        │
       ┌─────────────┴─────────────┐                          │
       │                           │                          │
       ▼                           ▼                          │
┌──────────────┐           ┌────────────────┐                 │
│   RESOLVED   │           │ RETURN_TO_BOT  │─────────────────┘
│(Chat cerrado)│           │ (IA reasume)   │
└──────────────┘           └────────────────┘
```

### Definición de Estados:

1. **`BOT_ACTIVE`**: La IA procesa y responde todos los mensajes entrantes según los flujos estándar.
2. **`WAITING_HUMAN`**: Se detectó una necesidad de transferencia. La IA envía un mensaje de acuse de recibo al cliente indicando que un asesor lo atenderá, y el webhook enruta futuros mensajes entrantes directamente a la bandeja sin invocar el LLM.
3. **`HUMAN_ACTIVE`**: Un operador específico tomó control de la conversación. Cualquier mensaje enviado desde el panel administrativo se despacha al cliente vía WhatsApp Cloud API con remitente de atención al cliente.
4. **`RETURN_TO_BOT`**: El operador completó la asistencia manual y oprime el botón **"Devolver a IA"**. El bot envía un saludo de reenganche (ej. *"¿En qué más te puedo ayudar?"*).
5. **`RESOLVED`**: Conversación concluida satisfactoriamente sin temas pendientes.

---

## 4. Experiencia del Cliente en WhatsApp

### Mensaje de Entrada en Espera
> "Entendido, te estoy comunicando con un compañero de nuestro equipo de atención humana 👨‍💼.
>
> He pausado mis respuestas automáticas. Un asesor leerá tu conversación y te responderá por aquí en unos minutos. ¡Gracias por tu paciencia!"

### Comportamiento mientras está en `WAITING_HUMAN`:
- Si el cliente envía más mensajes mientras espera, **la IA NO responde**.
- Los mensajes se acumulan cronológicamente en el chat del panel administrativo para que el operador tenga todo el contexto.
- Si transcurren **5 minutos** sin respuesta del personal (SLA de espera), se envía un mensaje automático de contingencia:
  > *"Seguimos buscando a un asesor disponible para ti. En horas punta podemos demorar un poquito más. Si tu consulta es urgente sobre un pedido en curso, también puedes llamarnos al +51 987 654 321."*

### Mensaje al Devolver la Conversación a la IA:
> "¡Listo! He reactivado a nuestro asistente virtual 🤖.
>
> Puedes continuar revisando el menú o consultando tu pedido en cualquier momento. ¡Buen provecho!"

---

## 5. Experiencia del Personal en el Panel Administrativo

### A. Alertas Visuales y Sonoras
- **Pestaña "Por atender" (Badge rojo):** Contador en tiempo real de conversaciones en estado `WAITING_HUMAN`.
- **Notificación de audio discreta:** Notificación acústica breve (chime) cada vez que una conversación entra a `WAITING_HUMAN`.
- **Orden cronológico inverso:** Las conversaciones con mayor tiempo de espera aparecen al inicio con indicador de tiempo transcurrido (ej. *"Esperando hace 3m"*).

### B. Vista del Chat
- **Diferenciación de burbujas:**
  - Burbuja Verde/Gris: Cliente (WhatsApp).
  - Burbuja Azul con badge 🤖: Respuesta generada por la IA.
  - Burbuja Morada con badge 👨‍💼: Respuesta enviada por un operador humano (con nombre del usuario).
  - Nota Amarilla centrada con candado 🔒: **Nota interna** (solo visible para el equipo, nunca se envía a WhatsApp).
- **Acciones Disponibles para el Operador:**
  - **Botón "Tomar control"**: Cambia el estado a `HUMAN_ACTIVE` y asigna la conversación al usuario actual.
  - **Campo de texto enriquecido:** Con soporte para emojis y plantillas de respuestas rápidas (canned responses).
  - **Botón "Devolver a IA":** Modal de confirmación rápida con opción de enviar mensaje de despedida automático.
  - **Ficha lateral del cliente:** Muestra historial de compras, dirección frecuente, pedido actual en curso y notas del cliente.

---

## 6. Respuestas Rápidas (Canned Responses) para Operadores

El panel incluirá atajos de teclado o selector desplegable con respuestas estandarizadas:

1. `/demora`: *"Hola [Nombre], disculpa la demora. Tuvimos alta demanda en cocina en este horario pico, pero tu pedido ya está saliendo en los próximos 10 minutos."*
2. `/cambio_pago`: *"Claro que sí, hemos actualizado tu método de pago a efectivo contra entrega. El repartidor llevará cambio para el billete que nos indiques."*
3. `/ubicacion`: *"Por favor envíanos la foto de la fachada o el nombre del edificio para que el repartidor no tenga problemas al llegar."*
4. `/despedida`: *"Ha sido un placer atenderte. Te dejo nuevamente con nuestro asistente para cualquier otra consulta que tengas."*

---

## 7. Métricas de Rendimiento y Auditoría (SLA)

Para evaluar la calidad de atención, el backend registrará en la tabla de auditoría:
- `conversation_id`: Identificador único.
- `trigger_reason`: Motivo del traspaso (`explicit_keyword`, `sentiment_negative`, `fallback_limit`, `manual_takeover`).
- `wait_time_seconds`: Segundos transcurridos desde `WAITING_HUMAN` hasta el primer mensaje del operador.
- `operator_user_id`: Identificador del empleado que atendió.
- `total_human_duration`: Duración total en modo humano antes de devolver al bot o cerrar.
- `resolution_category`: Clasificación al cerrar (Pedido aclarado, Reclamo solucionado, Información brindada, Spam).
