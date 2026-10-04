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

La arquitectura aprobada en Fase 1/1.5 guía la implementación. La Fase 2 construye la base backend local sin integraciones de producción.

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

- `codex/phase-02-backend-foundation`: servidor, PostgreSQL, Auth, inbox WhatsApp, seguridad y tests.
- `antigravity/phase-02-api-adapters`: adaptadores del panel y UX/UI.

Ambas ramas parten del mismo commit de `main`. Cada agente debe limitar sus cambios a su área y coordinar cualquier modificación de contratos compartidos. No se fusiona ni se despliega sin autorización.

## Seguridad y reglas de negocio

- No guardar credenciales en Git. Usar variables de entorno y secretos del proveedor de despliegue.
- El backend y la base de datos son la fuente de verdad de precios, disponibilidad, envío y estado del pedido.
- Crear pedidos solo después de una confirmación explícita del cliente; procesar webhooks con idempotencia.
- Permitir pausar la automatización y transferir la conversación a una persona.
- No confirmar pagos sin una verificación del proveedor de pagos.

## Estado

Fase 3: esquema de dominio con 23 tablas adicionales, RLS forzado y roles restringidos aplicado exclusivamente en agente-ia-staging. [Implementación y límites](docs/phase-03/domain-schema.md), [validación de staging](docs/phase-03/staging-validation.md) y [compatibilidad de modificadores](docs/phase-03/modifier-compatibility.md). No habilita worker, IA, pedidos reales ni envío WhatsApp.

Base de Fase 2: backend ejecutable con health/readiness, JWT Supabase, `/v1/me`, lectura de negocio e inbox WhatsApp firmado/deduplicado. Su foundation fue validada en staging durante Fase 2.1. Runtime completo de Auth/Meta aún pendiente. [Ejecución](docs/phase-02/implementation.md), [arquitectura](docs/architecture/README.md), [API](docs/api/contracts.md).

```sh
npm ci
npm run typecheck
npm run api:build
npm run api:test
npm run admin:build
```

`api:test` utiliza PostgreSQL temporal o TEST_DATABASE_URL local descartable. Para iniciar el backend configurar credenciales restringidas en .env ignorado y usar `npm run api:dev`; ver requisitos en la guía de implementación. El arranque no aplica migraciones.

## Comprobación de artefactos de diseño

Con Node.js instalado, sin dependencias externas:

```sh
node scripts/build-openapi.mjs --check
node scripts/validate-architecture.mjs
git diff --check
```

Estos comandos revisan especificaciones y consistencia documental; no son pruebas del backend ni de integraciones. El plan de pruebas de fase 2 está en [observabilidad y pruebas](docs/architecture/operations-and-tests.md).

### Fase 4 en PR Draft #12

[API operativa, servicios y worker interno](docs/phase-04/implementation.md), [contrato de modificadores para Antigravity](docs/phase-04/modifier-contract.md) y [evidencia staging](docs/phase-04/staging-validation.md). No hay deploy público ni activación OpenAI/Meta outbound.

### Fase 5 en PR Draft #16

[Runtime Responses API y Meta](docs/phase-05/implementation.md), [validación](docs/phase-05/staging-validation.md) y [seguridad/blockers de activación](docs/phase-05/activation-and-security.md). Las Fases 1–4 están integradas en main. Fase 5 conserva los contratos del panel, añade tools deterministas y transporte de confirmación cifrado; se prueba localmente con proveedores simulados. Hosting, secret manager, principales LOGIN y pruebas externas OpenAI/Meta están pendientes de autorización/configuración. No hay URL pública ni deploy.
