# Auditoría de Seguridad del Toolchain — Fase 5

## 1. Identificación del Advisory

- **Identificador de Seguridad**: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) / CVE-2026-93687
- **Severidad**: HIGH según el advisory reportado por npm/GitHub.
- **Paquete afectado**: `braces <= 3.0.3`
- **Tipo de vulnerabilidad**: Denegación de servicio (DoS) por agotamiento de pila (stack-exhaustion) ante patrones de expansión de llaves profundamente anidados.

---

## 2. Cadena de Dependencias Exacta

La vulnerabilidad reside **exclusivamente en dependencias de desarrollo (`devDependencies`)** dentro del workspace `@agente-ia/admin`:

```text
@agente-ia/admin@0.1.0 (devDependencies)
└── tailwindcss@3.4.19
    ├── chokidar@3.6.0
    │   └── braces@3.0.3  <-- AFECTADO
    ├── micromatch@4.0.8
    │   └── braces@3.0.3  <-- AFECTADO
    └── fast-glob@3.3.3
        └── micromatch@4.0.8
            └── braces@3.0.3  <-- AFECTADO
```

Ni `@agente-ia/api` ni `@agente-ia/shared` ni el bundle de producción de `@agente-ia/admin` incluyen `braces` o `tailwindcss`.

---

## 3. Análisis de Rutas de Remediación

`npm audit` propone como única solución:
```bash
npm audit fix --force
```
Esta acción forzaría la actualización a `tailwindcss@4.x` (`tailwindcss@4.3.3`).

### Evaluación de Cambios Disruptivos (Breaking Changes) de Tailwind CSS v4:
1. **Eliminación del archivo de configuración**: Tailwind v4 elimina por completo el soporte estándar para `tailwind.config.js` y `tailwind.config.ts`, migrando la configuración a directivas CSS `@theme`.
2. **Sintaxis CSS no compatible**: Reemplaza las directivas estándar `@tailwind base; @tailwind components; @tailwind utilities;` por `@import "tailwindcss";`, lo que rompe los plugins de PostCSS y la configuración de Vite del monorepo.
3. **Cambio en el motor de diseño**: Los tokens de color, variantes arbitrarias y utilidades de espaciado sufren discrepancias semánticas y requieren reescribir hojas de estilo y componentes existentes.
4. **Dependencias del ecosistema**: Plugins y utilidades complementarias del proyecto dependen de la arquitectura PostCSS de Tailwind v3.

### Ausencia de Parche Compatible en v3:
En el registro de `npm`, `braces` no cuenta con una versión `3.0.4` que corrija el advisory sin cambiar la API de AST, y `chokidar@3` / `micromatch@4` continúan requiriendo `braces@^3.0.2`.

---

## 4. Evaluación de Riesgo y Modelo de Amenazas

1. **Aislamiento en Tiempo de Compilación**: `tailwindcss`, `chokidar`, `fast-glob` y `braces` se ejecutan **únicamente** en la máquina del desarrollador y en el entorno de CI durante el paso de compilación (`tsc && vite build`).
2. **Cero Exposición en Runtime**: El resultado del build de Vite es HTML, CSS estático precompilado y JavaScript minificado en `dist/assets/`. Ni `braces` ni Node.js son desplegados al navegador del cliente ni forman parte del runtime de producción del backend.
3. **Inexistencia de Vector de Entrada No Confiable**: La entrada que procesa `braces` son los paths de archivos definidos en `content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}']` dentro de `tailwind.config.js`. No existe ninguna vía por la cual un usuario o payload externo pueda inyectar patrones de glob maliciosos durante la compilación.
4. **Riesgo Residual Evaluado**: El paquete afectado no forma parte del runtime productivo actual y el vector descrito queda limitado al toolchain de desarrollo/CI en la configuración presente. Se mantiene como riesgo residual aceptado temporalmente, no como riesgo absoluto nulo.

---

## 5. Decisión y Excepción Temporal

De acuerdo con las directrices operativas del proyecto:
- **No se ejecutó `npm audit fix --force`**: Se preservó la estabilidad funcional, la suite de pruebas (85 tests de admin) y la fidelidad visual de los componentes en Tailwind v3.4.19.
- **Excepción Temporal Documentada**: Se acepta temporalmente la advertencia en el toolchain de desarrollo porque no existe una remediación compatible sin migración mayor coordinada; la excepción debe revisarse cuando aparezca un parche o se programe la migración del toolchain.
- **Criterio de Levantamiento de la Excepción**: Se actualizará cuando `micromatch` / `braces` publiquen un parche menor compatible con Tailwind v3, o cuando se planifique una migración integral y testeada a Tailwind v4 en una fase dedicada con regresión visual automatizada.
