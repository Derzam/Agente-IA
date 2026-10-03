# Fase 1.5 — reconciliación de contratos

Estado: integración de diseño entre PR #1 (Antigravity) y PR #2 (Codex). Esta rama no implementa backend, WhatsApp, OpenAI ni Supabase en producción.

## Fuente de verdad

- **Dominio, seguridad, estados, concurrencia, idempotencia y OpenAPI:** arquitectura de Codex.
- **UX, componentes, flujos conversacionales y panel:** trabajo de Antigravity.
- `packages/shared/src/index.ts` conserva los DTO/enums canónicos del backend.
- `apps/admin/src/types/viewModels.ts` contiene modelos de vista del prototipo. No son contratos API.

## Decisiones cerradas

### Pedidos

Contrato canónico:

`awaiting_confirmation -> confirmed -> accepted -> preparing -> ready -> out_for_delivery -> delivered`

Para retiro, `ready -> delivered`. `cancelled` se permite solo según la matriz de lifecycle.

El panel no usa PATCH arbitrario de estado como contrato de backend. La API real usará acciones de transición y `expected_version` + `Idempotency-Key`.

### Conversaciones

Contrato canónico:

`bot_active | human_pending | human_active | closed`

La UI muestra etiquetas amigables, pero conserva los valores del dominio.

### Dinero

Backend/API: enteros en unidad mínima (`*_minor`) + moneda ISO. El panel puede formatear a decimal solo para presentación.

### Multi-negocio

La API real será tenant-scoped:

`/v1/businesses/{business_id}/...`

El panel no accede directamente a tablas de Supabase para reglas de negocio.

### Handoff

El recurso canónico es `HumanHandoff` con create/claim/resolve. La UI de "tomar control" se mapeará a esas operaciones, no a endpoints ad-hoc.

### Tiempo real

MVP inicial: polling controlado mientras la vista está activa. SSE puede incorporarse después sin cambiar los modelos de dominio. WebSockets no son requisito de Fase 2.

## Separación UI/API

El prototipo de Antigravity necesitaba campos de presentación que no forman parte de los DTO de dominio actuales, por ejemplo:

- nombre/teléfono resumido del cliente dentro de una tarjeta de pedido;
- snippet y contador no leído en listas de conversaciones;
- métricas y formatos listos para el dashboard;
- configuración visual del agente.

Por eso el panel usa `viewModels.ts` y mocks propios. Antes de desactivar `USE_MOCK_DATA`, Fase 2 debe definir proyecciones/read models explícitos (por ejemplo `OrderListItem`, `ConversationListItem`) o adaptadores que compongan los DTO existentes. No se debe fingir que los mocks ya coinciden con la API.

## Modificadores de menú

Se mantiene como decisión para Fase 2 separar conceptualmente:

- `modifier_groups`: required/min/max/orden.
- `modifier_options`: nombre/precio/disponibilidad.

La propuesta Codex actual con `group_key` es válida como borrador, pero no se debe migrar hasta cerrar este punto.

## Pendientes antes de backend funcional

1. Proyecciones de lectura necesarias por el panel.
2. Separación final modifier_groups/modifier_options.
3. País, moneda e impuestos.
4. Horarios/timezone.
5. Zonas, tarifas y mínimos.
6. Política de cancelación.
7. Autenticación del panel y persistencia de sesión.
8. Retención/privacidad.
9. Versiones de Meta Graph, SDK Supabase y modelo OpenAI.
10. Hosting/región/backups.

## Criterio de integración

Fase 1 queda lista para merge cuando:

- los contratos canónicos de Codex permanecen sin degradación;
- el panel compila usando modelos de vista separados;
- no quedan imports del prototipo que reemplacen `packages/shared`;
- los estados visibles siguen la máquina canónica;
- los checks estáticos de arquitectura y el build/typecheck del panel pasan;
- no existen secretos.
