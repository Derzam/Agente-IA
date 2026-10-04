# Fase 4 — Antigravity: panel conectado a API real

Base: main @ 188fb2f1f142513cc2f8b31b544887210b8c4375
Rama: antigravity/phase-04-real-api

## Objetivo
Cerrar el panel administrativo contra la API real implementada por Codex, eliminando comportamiento ficticio en real mode.

## Alcance
- Catálogo y modificadores contra contrato final.
- Settings y zonas de entrega.
- Pedidos y transiciones canónicas.
- Pagos cash_on_delivery.
- Conversaciones y handoffs.
- Polling y refresh al recuperar foco.
- expected_version, Idempotency-Key y errores 401/403/404/409/422/429/503.
- Mocks solo cuando VITE_USE_MOCK_DATA=true.

## Restricciones
- No crear migraciones ni tocar RLS/roles.
- No inventar endpoints.
- No activar OpenAI.
- No conectar Meta real.
- No deploy.
- No tocar LlevaKí.
- No tocar mouly-control-de-ingresos.
- No merge sin autorización.

## Criterio de salida
- Real mode consume solo API propia.
- Ninguna función no soportada se presenta como persistida.
- Tests de adapters/services/UI y CI verdes.
- Responsive y accesibilidad preservados.

## Adopción del contrato final de Codex

Antigravity adopta el contrato publicado por PR #12 sin copiar migraciones ni lógica backend:

- `ModifierGroup` y `ModifierOption` son el contrato preferido en real mode.
- La UI usa las rutas anidadas `/modifier-groups` y `/options` con versiones independientes.
- El puente legacy `ProductOption.group_key` queda únicamente como fallback de lectura durante la separación temporal de ramas y podrá retirarse después de integrar PR #12.
- Orden, estado activo, min/max y opciones se persisten mediante el contrato jerárquico real.
- `BusinessSettings.tax_policy` se expone explícitamente como sin configurar, `none` con 0%, o `exclusive` con tasa explícita en puntos base.
- La UI no infiere IVA ni ninguna tasa por país.
- Una política fiscal ausente se muestra como bloqueo de cotización, no como 0% implícito.
- OpenAI, Meta outbound y pagos electrónicos permanecen desactivados.
