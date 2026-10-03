# Agente-IA

Proyecto para desarrollar un agente de atención y pedidos por WhatsApp para un negocio de comida.

## Objetivo

Permitir que los clientes consulten el menú y realicen pedidos por WhatsApp, con precios y disponibilidad validados por el servidor. El negocio conservará el control de la atención humana y de los pedidos.

## Arquitectura prevista

- **API:** Node.js y TypeScript; webhooks y reglas de negocio.
- **Canal:** WhatsApp Business Platform / Cloud API oficial.
- **IA:** OpenAI para interpretar solicitudes y redactar respuestas.
- **Datos:** Supabase (PostgreSQL, autenticación y almacenamiento según necesidad).
- **Panel:** aplicación web administrativa.
- **Contratos:** tipos y esquemas compartidos entre API y panel.

La arquitectura es una propuesta inicial y se concretará en la documentación de Fase 1 antes de implementar integraciones de producción.

## Estructura inicial

```
apps/
  api/                 Backend (responsabilidad Codex)
  admin/               Panel web (responsabilidad Antigravity)
packages/
  shared/              Tipos y contratos acordados
supabase/
  migrations/          Migraciones versionadas
docs/
  architecture/
  api/
  conversations/
tests/
```

## Trabajo paralelo

- `codex/phase-01-architecture`: arquitectura técnica, datos, API, seguridad y pruebas.
- `antigravity/phase-01-ux`: experiencia conversacional, UX/UI y necesidades del panel.

Ambas ramas parten del mismo commit de `main`. Cada agente debe limitar sus cambios a su área y coordinar cualquier modificación de contratos compartidos. No se fusiona ni se despliega sin autorización.

## Seguridad y reglas de negocio

- No guardar credenciales en Git. Usar variables de entorno y secretos del proveedor de despliegue.
- El backend y la base de datos son la fuente de verdad de precios, disponibilidad, envío y estado del pedido.
- Crear pedidos solo después de una confirmación explícita del cliente; procesar webhooks con idempotencia.
- Permitir pausar la automatización y transferir la conversación a una persona.
- No confirmar pagos sin una verificación del proveedor de pagos.

## Estado

Fase 1: preparación de repositorio y especificación técnica/UX. Aún no hay conexión a WhatsApp, OpenAI, Supabase ni sistemas de pago.
