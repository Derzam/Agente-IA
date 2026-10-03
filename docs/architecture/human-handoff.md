# Control humano — propuesta

ConversationStatus: bot_active → human_pending → human_active → bot_active; cualquier estado puede cerrarse por operador autorizado, con handoff resuelto. Un cierre no cancela pedidos. Cliente vuelve a escribir en conversación cerrada → nueva conversación.

HandoffReason: explicit_request, misunderstanding, complaint, payment_issue, system_failure. Solicitud de persona se atiende inmediatamente; dos fallos consecutivos de comprensión, reclamo, alergia/riesgo de seguridad del alimento o discrepancia de pago escalan. No prometer tiempos de atención sin configuración operativa.

Crear handoff pending, conversation human_pending, incrementar automation_epoch y audit/outbox en una sola transacción. Unicidad parcial asegura uno abierto. Respuesta inicial determinista de transferencia puede enviarse como evento de sistema explícitamente permitido; luego todos los mensajes entrantes se guardan sin bot. Si la ventana cerró, ninguna respuesta libre automática ni humana elude política Meta.

Operador puede claim pending → active si miembro activo del negocio; assignment por manager/owner. Concurrencia resuelta con expected_version. Mensajes humanos requieren human_active y asignación al actor o manager/owner; recipient es el cliente de esa conversación. Guardar actor y outbox idempotente. Clientes del panel ven pending/active, assigned_user_id, razón, último mensaje y advertencias de entrega.

Resolver requiere resolución, expected_version y acción `resume_bot` o `close`. Solo asignado o manager/owner; incremento epoch y cambio de conversación atómicos. No reanudar por timeout automáticamente. Al devolver a IA reconstruir estado DB y resumen, no ejecutar comandos antiguos pendientes. Jobs anteriores se cancelan si epoch cambió. Ya iniciados contra Meta pueden finalizar, limitación visible en auditoría.

Sin operadores disponibles, mantener pending, alertar al negocio y mostrar disponibilidad configurada; no simular atención humana. Fallo de aviso al panel no devuelve control a bot. Fase 2 debe definir horarios, equipo responsable, alertas y SLA.
