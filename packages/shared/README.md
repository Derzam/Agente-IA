# Contratos compartidos — propuesta v0.1

`src/index.ts` contiene declaraciones de tipos de diseño, no cliente HTTP ni validadores runtime. `docs/api/openapi.json` define validación de DTO y endpoints propuestos. Ambos se revisan juntos; en fase 2 se generarán tipos/validadores desde OpenAPI para eliminar duplicación, se creará package.json con exports y se fijará TypeScript. Hoy no existe paquete publicable ni backend.

Compartir enums, DTO de recursos, comandos, errores, paginación y eventos públicos. No compartir entidades DB, SDK Meta/OpenAI, credenciales, JWT completos, cuerpos de webhook ni lógica de autorización. UUID/RFC3339/currency son strings en TypeScript; requieren validación runtime.

Antigravity puede usar estos tipos para mocks locales; no presentar endpoints como activos. Todo cambio incompatible requiere actualizar contrato, ejemplos, revisión de ambas áreas y versión antes de implementar.
