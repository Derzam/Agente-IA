# Dependencias y auditoría — 2026-10-03

Backend fijado: fastify5.12.5, pg8.23.1, jose6.2.12, zod4.6.5, @fastify/cors11.3.0, @fastify/helmet13.1.1 y @fastify/rate-limit11.2.0. Tests/dev: tsx4.23.15, @types/pg8.23.1, ajv8.20.0, ajv-formats3.0.1. TypeScript y @types/node del workspace existente. CLI Supabase2.119.0 usada solo para crear archivo; no nueva dependencia runtime ni conexión remota.

`npm audit --omit=dev --workspace=@agente-ia/api`: cero vulnerabilidades reportadas. CI aplica este check al backend nuevo. Auditoría global reporta **5 high,0 critical** en la cadena del tooling existente del panel: braces, chokidar, micromatch, fast-glob y tailwindcss. No se oculta el exit code1 del audit global ni se declara seguridad global limpia.

Aviso base: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), stack exhaustion por patrones profundamente anidados en braces<=3.0.3. npm propone Tailwind4 como actualización mayor para retirar esa cadena. Riesgo principalmente de procesamiento de patrones en tooling de build/watch del panel; no afirmar inexplotabilidad. No se ejecutó `audit fix --force` ni se migró frontend durante base backend. Recomendación: Antigravity revise upgrade compatible en tarea de panel y vuelva a ejecutar audit/build. Manifiesto/componentes apps/admin sin cambios.

Lockfile conserva dependencias existentes y registra el nuevo workspace con versiones exactas. npm ci reproducible. Proveedores/versiones Graph/OpenAI no se fijan porque no se usan; no hay SDK Supabase en runtime para JWT/SQL (jose y pg son adaptadores).
