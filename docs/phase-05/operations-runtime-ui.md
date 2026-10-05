# Operación y UX de Runtime — Fase 5

## 1. Principio Fundamental: Fidelidad de Estado y Cero Simulación

En modo real (`VITE_USE_MOCK_DATA=false`), el panel administrativo de **Agente-IA** solo refleja estados que el contrato público del backend puede demostrar. Cuando el backend no publica readiness o telemetría de un proveedor, la UI muestra explícitamente que ese estado no está disponible y no lo infiere.

Reglas aplicadas sin excepción:
- **Nunca inventar estado de proveedores** (Meta WhatsApp, OpenAI, Worker).
- **Nunca asumir éxito prematuro**: una respuesta HTTP 202 de la API representa un mensaje **encolado** (`queued`) en el outbox transaccional, jamás un mensaje "enviado" o "entregado".
- **Sin ping directo desde el navegador a Meta u OpenAI**: PR #16 no añade un endpoint público de readiness de proveedores; por ello el panel no muestra Meta/OpenAI como configurados o disponibles.
- **Sin cálculo especulativo de costos monetarios**: Solo se presentan métricas operativas de consumo (tokens, llamadas a herramientas, turnos, cuota restante) reportadas oficialmente por el backend.

---

## 2. Máquina de Estados de Entrega (Meta / Outbox)

Se implementó el ciclo de vida completo de 9 estados en `ChatMessage.deliveryStatus` y el componente accesible `OutboxStatusBadge`:

| Estado | Etiqueta en UI | Descripción Operativa |
| :--- | :--- | :--- |
| `queued` | **Encolado** | Aceptado por API (HTTP 202) y persistido en tabla outbox transaccional. Pendiente de toma por el worker. |
| `pending` | **Pendiente** | En proceso de preparación interna por el despachador. |
| `sending` | **Enviando** | Despachado hacia la API de WhatsApp Cloud / Graph API de Meta; esperando ACK inicial. |
| `sent` | **Enviado al proveedor** | Confirmado por el upstream de Meta con `wamid` oficial. |
| `delivered` | **Entregado** | Confirmado recibido en el dispositivo del cliente (doble check gris). |
| `read` | **Leído** | Confirmado visto/abierto por el cliente en WhatsApp (doble check azul). |
| `failed` | **Falló el envío** | Rechazado o fallido con código de error saneado (ej. `WINDOW_CLOSED`, `RATE_LIMITED`). |
| `unknown` | **Estado por confirmar** | Estado de entrega no reportado aún o ambiguo. Nunca se oculta como éxito ni fallo. |
| `dead_letter` | **Requiere revisión** | Agotados todos los reintentos automáticos del worker o retenido en cola de mensajes no procesables. |

---

## 3. Saneamiento Riguroso de Códigos de Falla

El adaptador `conversationAdapter.ts` incorpora la función `sanitizeFailureCode`, la cual rechaza activamente cualquier cadena que contenga:
- Bearer tokens, JWTs, o prefijos de autenticación (`ey...`, `EAAB...`, `Bearer`).
- Dumps de solicitud/respuesta JSON, stacks de excepciones o trazas de ejecución.
- URLs, endpoints de red o query parameters con IDs telefónicos o secretos.
- Inyecciones SQL o cadenas mayores a 64 caracteres.
- Si no es un código seguro y conciso, se muestra la etiqueta genérica segura `ERROR_DESCONOCIDO`.

---

## 4. Prioridad Incondicional de Handoff Humano

Cuando una conversación entra en estado de atención humana:
- **`human_pending`**: Se muestra un banner advertencia con la leyenda oficial: *"Automatización suspendida. Pendiente de atención humana."* Los mensajes automáticos de IA se suspenden automáticamente.
- **`human_active`**: Se muestra un banner de control indicando: *"Conversación bajo control humano."* Se suspende la generación de mensajes por IA.
- **Sin Bypass**: La interfaz no ofrece ningún botón para "forzar IA" o eludir el handoff mientras la conversación esté bajo atención humana.

---

## 5. Separación entre Política de Negocio y Runtime Técnico de IA

En la pantalla de Configuración (`SettingsView`):
- **Permiso del Negocio (`ai_enabled`)**: Switch de configuración claramente etiquetado como *"Automatización de IA permitida por el negocio"*. No se confunde con "OpenAI conectado".
- **Estado técnico del runtime**: PR #16 implementa OpenAI/Meta internamente, pero mantiene las 49 operaciones públicas existentes y no publica un endpoint administrativo de readiness, modelo, circuito o presupuesto.
- Los componentes de badges de proveedor conservan etiquetas locales de presentación para una futura integración, pero **no constituyen enums de API ni se alimentan con valores hardcodeados en real mode**.
- `ai_enabled` continúa representando únicamente el permiso comercial del negocio.

---

## 6. Disyuntor Operativo (Circuit Breaker)

PR #16 no publica el circuito en el contrato administrativo. `CircuitBreakerNotice` queda como componente de presentación sin datos reales. El banner genérico y el scheduler admiten defensivamente `CIRCUIT_OPEN` si llega en un error: muestran la suspensión y detienen el polling hasta desmontar/reactivar la vista. Esto no añade el código al enum compartido ni presume un endpoint de restauración.

---

## 7. Manejo de Errores 429 y 503

### HTTP 429 (Rate Limited):
- Se analiza `Retry-After` como segundos enteros o fecha HTTP, también para HTTP 503; los valores malformados no se interpretan como segundos.
- `ApiErrorBanner` muestra la cuenta regresiva contra un plazo absoluto. Cada nuevo error renueva la espera aunque traiga el mismo número de segundos.
- El botón de reintento manual permanece deshabilitado hasta que expira el período de enfriamiento para prevenir bucles de saturación.

### HTTP 503 (Provider Unavailable):
- Se despliega un banner informativo indicando que el servicio aguas arriba no está disponible temporalmente.
- **Preservación de Sesión**: Un 503 jamás se confunde con un 401/403, por lo que nunca dispara `onAuthExpired` ni desloguea al operador.

---

## 8. Polling Resiliente y Desduplicación

El hook `usePolling` y la vista `ConversationsView` garantizan:
- **Visibility Guard**: El polling se detiene cuando la pestaña está oculta (`document.visibilityState === 'hidden'`).
- **Focus Guard**: El polling se suspende si la ventana no tiene el foco del usuario.
- **Backoff Progresivo**: Espera exponencial limitada con jitter para fallos de red, timeout o HTTP 503. Se respeta un `Retry-After` mayor que esa espera.
- **Plazos persistentes**: Blur/focus, visibilidad y nuevos renderizados no borran el plazo de espera. Solo hay un timer y una solicitud de polling activa. Al desmontar se cancela la solicitud y su finalización tardía no crea otro timer.
- **Errores propagados**: Los loaders de Dashboard, Pedidos y Conversaciones muestran el error y lo propagan al scheduler. La primera carga también usa ese scheduler, evitando dos cargas simultáneas al montar.
- **Deduplicación**: Se indexan los mensajes por ID único (`id` / `outbox_id`), preservando mensajes optimistas locales encolados mientras el backend los confirma, evitando parpadeos y duplicación.
- **Preservación de Scroll**: El contenedor de mensajes detecta si el usuario está leyendo mensajes anteriores (`isNearBottomRef`) y no fuerza el autoscroll hacia abajo ante cada respuesta del polling.

---

## 9. Limpieza de Puentes Legacy en Catálogo

- Se eliminaron del código de producción las funciones de aplanamiento legacy (`flattenModifierGroupsForWrite`, `mapModifierOptionToDtoInput`, `modifierGroupKey`).
- Toda mutación de modificadores se realiza a través de la jerarquía canónica de Fase 4 (`ModifierGroup` con opciones hijas `ModifierOption`), utilizando control de concurrencia optimista (CAS) mediante `version` / `expected_version`.
- Se mantiene únicamente el fallback de lectura para productos preexistentes que aún no hayan sido migrados a la estructura canónica.

---

## 10. Política Fiscal y Medios de Pago

- **Política Fiscal**: Se admite exclusivamente `unconfigured`, `none` (0%), y `exclusive` (tasa configurada explícitamente por el negocio). Si la política no está configurada, se bloquea la cotización y se advierte al operador. No existen presets fiscales hardcodeados.
- **Métodos de Pago**: Se restringe rigurosamente a `cash_on_delivery`. No se expone ningún medio de pago electrónico (Stripe, PayPal, Deuna, etc.).

---

## 11. Presupuesto Agotado y Ventana de WhatsApp

- **`AI_BUDGET_EXCEEDED` / `BUDGET_EXCEEDED`**: Se notifica claramente al operador: *"Presupuesto de automatización agotado. Se alcanzó el límite configurado de automatización para esta conversación o negocio."* No se ejecutan reintentos automáticos ni ráfagas de polling.
- **`WINDOW_CLOSED`**: Se despliega aviso informativo indicando que han transcurrido más de 24 horas desde el último mensaje del cliente y que la política de WhatsApp Cloud restringe el envío libre de mensajes fuera de la ventana.

---

## 12. Panel Principal (Dashboard) Operativo y Honesto

- Se erradicó por completo el widget simulado previo (*"Asistente Virtual Max"*, tasa ficticia de *84%*, *"Configurar Tono"*).
- En su lugar, el bloque **Operación & Runtime (Fase 5 Staging)** muestra las limitaciones del contrato público:
  - Meta: **No verificado por endpoint público**. No afirma HMAC, outbox activo o credenciales configuradas.
  - OpenAI: **Sin estado público de runtime**. No afirma modelo, disponibilidad, circuito o presupuesto.
  - Conteo de conversaciones en espera humana pendientes (`human_pending`) extraído de la colección autoritativa.
  - Hosting: **No desplegado**, sin inventar URL pública o health check.

## 13. Regresión de las correcciones

Se añaden pruebas de timers con reloj controlado y pruebas DOM con React/JSdom para comprobar transiciones `null → error → null`, renovación de cooldown, pausa/focus, limpieza al desmontar, callback actualizado sin reinicio, 503, suspensión por presupuesto/circuito y propagación de 429 en las tres vistas reales. Otra prueba comprueba que una respuesta tardía de otro chat no sustituya los mensajes de la conversación seleccionada. JSdom se utiliza exclusivamente como dependencia de desarrollo.

### Validación local de estas correcciones

- `npm ci --no-audit`, typecheck, builds Admin/API, OpenAPI, arquitectura y whitespace: aprobados.
- Admin: **114 pruebas**, incluidas 25 nuevas pruebas de regresión del scheduler y ciclo de vida de componentes.
- Backend HTTP, contratos, reglas de dominio y JWKS: **142 pruebas** aprobadas, sin PostgreSQL ni proveedores reales.
- Combinación local con PR #16 (`c48be1e6aad9ae8cd85d24aee44a11fc8b29f5dd`): tipos, 114 pruebas Admin, ambos builds, OpenAPI, arquitectura y esas 142 pruebas backend aprobados. La combinación requiere regenerar `package-lock.json` conservando las dependencias de ambos PR; no hay conflictos de código.
- En esa combinación también pasan **25 pruebas de proveedores de Fase 5** con respuestas simuladas, sin llamadas reales a OpenAI/Meta.
- No se ejecutó la regresión PostgreSQL: no hay servidor local disponible en este entorno. Tampoco se ejecutaron pruebas reales de OpenAI/Meta.
- `npm audit` fue bloqueado por revisión automática porque transmite metadatos de dependencias a npm. No se afirma una auditoría nueva ni CI verde para este cambio; publicar la rama activaría el CI existente, que incluye esa auditoría. Se requiere autorización explícita para esa transmisión antes de publicar. No se modificó ni redujo el workflow.
