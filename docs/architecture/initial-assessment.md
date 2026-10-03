# Inspección inicial — 2026-10-02

Repositorio: `Derzam/Agente-IA`. Base inspeccionada: `65156a9ca2c1428dec5b3c7829bb06067e528420`.
Rama de trabajo: `codex/phase-01-architecture`. `main` y las dos ramas de fase 1 partían del mismo commit.

La carpeta local inicialmente tenía un Git vacío en `master`, sin remoto; se recuperó `origin` y se seleccionó la rama obligatoria antes de editar archivos.

## Inventario completo

| Archivo/directorio | Estado encontrado |
|---|---|
| README.md | Objetivo, responsabilidades, reglas de negocio y estructura prevista |
| .env.example | Variables vacías para Meta, OpenAI y Supabase; sin secretos |
| .gitignore | Ignora entornos locales, dependencias, builds y logs |
| .github/PULL_REQUEST_TEMPLATE.md | Plantilla con alcance, validación y seguridad |
| apps/api, apps/admin, packages/shared | Solo `.gitkeep`; ningún servicio ni componente |
| supabase/migrations, tests | Solo `.gitkeep`; ningún esquema ni test |
| docs/architecture, docs/api, docs/conversations | README con intención de cada área |

No hay package.json, lockfile, configuración TypeScript, CI, SDK, servidor, endpoint, modelo, migración ni integración implementada. No se encontraron AGENTS.md ni instrucciones locales adicionales en el árbol recuperado. No hay validaciones ejecutables del backend existentes.

## Alcance de esta fase

Se preserva toda la estructura y el área frontend. Se añaden especificaciones, un contrato de API legible por máquina, declaraciones TypeScript de diseño y una comprobación estática de consistencia documental. Estos artefactos no constituyen un backend ejecutable. No se conectan cuentas, números, bases ni servicios reales; no se despliega ni se aplica SQL.

Las versiones de Node, TypeScript, framework HTTP y SDK se fijarán con lockfile en fase 2, después de revisar compatibilidad vigente. No se inventan versiones de dependencias o de Graph API.
