# Registro de decisiones y pendientes

Todas son propuestas revisables v0.1, no infraestructura implementada.

| Decisión | Motivo / alternativa / consecuencia |
|---|---|
| Monolito modular + worker | menor coste operativo; microservicios añadirían consistencia distribuida sin necesidad demostrada; separar después por carga |
| PostgreSQL inbox/outbox | transacción con negocio; Redis/broker futuro detrás de puertos si volumen lo exige; medir polling y contención |
| Tenant obligatorio desde MVP | un negocio inicial sin impedir varios; FK compuestas y scopes en todas las consultas |
| API negocio como límite del panel | centraliza reglas; acceso directo Data API requeriría duplicar autorización/invariantes; Auth permanece proveedor |
| Rol runtime DB restringido | evita bypass silencioso de service_role; requiere implementar contexto transaccional y políticas probadas |
| Confirmación por botón verificado | evidencia vinculada a quote, no decisión del modelo; texto «sí» invita a confirmar |
| Precios enteros y snapshots | conserva histórico; edición catálogo no altera pedido; quote revalidada exige nuevo consentimiento si cambia |
| Cash MVP, sin PSP | registro manual no cobro; estado financiero distinto de fulfillment |
| OpenAPI + declaraciones shared | permite mocks paralelos sin implementación ficticia; fase 2 generará tipos/validadores desde contrato |
| Polling inicial panel | sin transporte realtime extra; eventos versionados definidos para evolución |

## Bloqueantes antes de producción

| Pendiente | Responsable de decisión | Default de diseño / qué bloquea |
|---|---|---|
| País, moneda, impuestos e inclusión/redondeo | negocio con asesoría local cuando corresponda | sin tasa inferida; confirmar pedidos bloqueado hasta política válida |
| Horarios, timezone, pickup/delivery y zonas/tarifas | negocio | configuración explícita, no habilitar delivery sin zonas |
| Cancelaciones y pago efectivo permitido | negocio | matriz propuesta y cash pendiente sujetos a aprobación operativa |
| Privacidad, residencia y retención legal | negocio + responsable datos | plazos provisionales no política legal; no producción sin revisión |
| WABA/test number, Graph API version, permisos/templates/consentimiento | negocio + Codex | validar docs actuales/sandbox; páginas Meta limitaron consulta con429 |
| Modelo OpenAI, coste/límites y retención proyecto | Codex + negocio | modelo configurable; benchmark sintético y presupuesto antes de activar |
| Hosting/región/plan Supabase, backups/SLO | Codex + negocio | contenedores API/worker; no despliegue esta fase |
| Framework HTTP/validación/test y versiones | Codex | seleccionar y fijar lockfile en fase2; sin instalar stack prematuramente |
| Framework panel, Auth persistence, revisión contratos | Antigravity + Codex | mocks contratos; acuerdo aún pendiente |
| Operadores, horarios y alertas/SLA handoff | negocio + Antigravity | no auto-reanudar; cola pending hasta intervención |

## Riesgos residuales

Envío Meta puede ser ambiguo y generar duplicado si humano decide reenviar; no hay atomicidad externa. Un mensaje ya iniciado puede terminar tras pausa de bot. Un booleano availability no reserva inventario; si el negocio necesita stock, requiere nueva decisión de reservas. Políticas RLS y multi-tenant solo estarán garantizadas tras DB tests con roles reales locales. Contratos pueden requerir cambios al revisar UX y payloads vigentes de Meta. Retención de historial/tombstones debe balancear minimización y replay; backup también contiene PII. No presentar una documentación completa como sistema operativo.
