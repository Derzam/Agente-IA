# Ciclo de pedidos — propuesta

Carrito editable `active → converted | expired`. Un carrito no es un pedido. Se omite `draft` del pedido MVP; la primera propuesta es `awaiting_confirmation` con resumen, importe, fulfillment, versión y TTL (propuesta: 10 minutos).

Estados OrderStatus: `awaiting_confirmation`, `confirmed`, `accepted`, `preparing`, `ready`, `out_for_delivery`, `delivered`, `cancelled`. `delivered` significa también retiro completado. Se conserva out_for_delivery para distinguir entrega de retiro; pagos tienen estado separado.

| Desde | Hasta | Actor autorizado | Evento / condiciones |
|---|---|---|---|
| awaiting_confirmation | confirmed | cliente mediante servicio de confirmación | botón opaco de un solo uso asociado a cliente, pedido, versión y vencimiento; revalidación completa |
| awaiting_confirmation | cancelled | cliente, operador, sistema | cancelación explícita, reemplazo por propuesta nueva o TTL vencido |
| confirmed | accepted | operator/manager/owner | aceptación del negocio, negocio operativo |
| accepted | preparing | operator/manager/owner | cocina inicia preparación |
| preparing | ready | operator/manager/owner | preparación terminada |
| ready | out_for_delivery | operator/manager/owner | salida; solo delivery |
| out_for_delivery | delivered | operator/manager/owner | entrega registrada con actor y hora |
| ready | delivered | operator/manager/owner | retiro completado; solo pickup |
| confirmed | cancelled | cliente u operator/manager/owner | solicitud explícita antes de aceptación, motivo obligatorio |
| accepted | cancelled | manager/owner | excepción operativa documentada |
| preparing | cancelled | manager/owner | excepción operativa documentada |
| ready | cancelled | manager/owner | excepción operativa documentada |
| out_for_delivery | cancelled | manager/owner | excepción operativa documentada; liquidación manual si procede |

Todas las demás transiciones son inválidas (409 INVALID_ORDER_TRANSITION); terminales no se reabren, no hay retroceso ni saltos. Mismo comando repetido con misma clave devuelve resultado guardado, no una transición nueva. Otro comando hacia el mismo estado se rechaza; no incrementa versión. Un cliente no acepta/prepara/entrega; IA no cambia estado por texto libre. El panel no confirma en nombre del cliente en el MVP.

La API administrativa solo admite acciones accept/start_preparation/mark_ready/dispatch/complete/cancel, con matriz anterior; no un PATCH status arbitrario. Cliente confirma mediante challenge determinista: texto «sí» puede pedir el botón de confirmación, pero no ejecutar por sí solo una confirmación generativa. Herramienta confirm_order solo opera cuando el orquestador dispone de evidencia verificada de ese botón; el modelo no construye evidencia.

Confirmación: transaction + lock pedido/carrito, version esperado, challenge válido y remitente, TTL, disponibilidad, opciones, horario, mínimos, moneda, política fiscal y entrega. Si precios/datos cambian: 409 QUOTE_CHANGED, invalidar propuesta y emitir una nueva; no cobrar/confirmar al precio nuevo sin aprobación. Si expiró: 409 QUOTE_EXPIRED, cancelar propuesta. Una propuesta no reserva stock.

Cada éxito incrementa version y escribe order_transitions, audit y outbox atómicamente. `confirmed` no implica pago; `delivered` no implica pago. Cash pendiente se marca paid mediante registro humano autorizado; cancelación con pago registrado requiere conciliación, sin reembolso automático. Fallo de envío WhatsApp no deshace un pedido confirmado: operador ve pedido + entrega de notificación fallida.
