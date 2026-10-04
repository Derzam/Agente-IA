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
