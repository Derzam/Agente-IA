# Observabilidad, operación y pruebas — propuesta

Estado actual: logs/request ID y suite foundation IMPLEMENTED; métricas exportadas, alertas, workers y pruebas de pedidos siguen PLANNED. [Ejecución y límites](../phase-02/implementation.md), [registro fase 2](../phase-02/validation.md). La sección de verificación fase 1 es histórica.

## Telemetría mínima

Logs JSON estructurados con timestamp UTC, level, service, environment, request_id, trace_id, business_id, resource_id, causation_id, event_type, error_code y duration_ms. request_id generado/validado en servidor; ninguna cabecera arbitrary inyecta líneas de log. Propagar correlación inbox → turno → herramientas → order → outbox → Meta. IDs opacos; no mensajes, prompts completos, teléfono, dirección, bearer, challenge o respuesta completa de proveedor por defecto.

Métricas: webhook recibidos/firmas inválidas/duplicados/ACK latency; edad de inbox/outbox, retries/dead_letter/unknown; turn latency, llamadas IA/tokens entrada-salida/coste estimado/modelo; errores WhatsApp por código, envío y entrega; creación/confirmación/cancelación pedidos; handoffs por razón/tiempo esperando; saturación DB/worker. No IDs de conversación/cliente como labels (alta cardinalidad/PII); tenant labels solo acotados/controlados. Trazas muestreadas sin bodies; audit separado y append-only. Coste IA estimado con tabla de precios versionada futura, no convertirlo en cobro al cliente.

SLO iniciales para validar bajo carga, no garantías actuales: ACK webhook p95 <1s tras commit; respuesta útil p95 <15s en turno ordinario; API read p95 <300ms; 99.5% disponibilidad mensual. Alertas propuestas: DB indisponible, firmas inválidas anormales, cola >2min, dead letter >0, unknown >0, handoff sin asignar >5min en horario, error proveedor >5%/5min, cuota IA >80%. Definir destinatarios y SLA antes de habilitar alertas reales; no se envía comunicación externa en esta fase.

## Operación futura

1. Caída DB: webhook 503, API readiness no lista; no ACK que pierda datos. Restaurar y permitir retries/dedupe.
2. Caída OpenAI: breaker, mensaje determinista/handoff; no inventar resultado económico. Reanudar solo jobs vigentes.
3. Token Meta inválido: bloquear envío, alertar, rotar secret sin imprimirlo; mantener pedidos y outbox.
4. Envío unknown: revisar correlación/status; decisión humana auditada, sin repeat de efecto de pedido.
5. Dead letter: diagnóstico redactado y replay con clave original, versión/epoch vigentes. No usar SQL manual que salte invariantes.
6. Recuperación: backup y restore a entorno aislado; objetivo propuesto RPO<=1h/RTO<=4h sujeto a hosting/plan. Probar antes de producción y trimestralmente.

Configuración: separar dev/test/staging/prod y secretos; sandbox exclusivamente ficticio en fase 2. Migraciones versionadas revisadas con rollback/forward plan y fixtures local; no se generan/aplican migraciones en fase 1. API liveness solo proceso; readiness DB/config; worker shutdown no toma jobs nuevos y libera/vence leases.

## Matriz de pruebas de fase 2

| Nivel | Casos y evidencia exigida |
|---|---|
| Unitarias dominio | todos los pares de estados incluyendo inválidos/terminales; pickup vs delivery; redondeo entero, mínimos, extras, TTL/horarios, roles y precios modificados |
| Integración | HTTP→servicio→Postgres local, Auth stub con firmas test, transactions/rollback/outbox, error format y request_id; sin servicios reales por defecto |
| Webhook | GET challenge exacto; raw HMAC, JSON malformado, firma alterada, múltiples entries/messages/statuses, canal no configurado, tipos unsupported, DB caída sin ACK |
| Contratos | requests/responses contra OpenAPI; mocks Antigravity mismos schemas; enums shared; casing/null/pagination/dinero; cambios incompatibles bloquean CI |
| DB/RLS | ejecutar con roles runtime/anon/authenticated, no superuser; tenant A no accede/modifica B; FK compuestas, GRANTs, USING/WITH CHECK, soft delete, índice/plan y restricciones de totals |
| Idempotencia | 20 webhooks concurrentes mismo message ID → un efecto; confirmaciones de propuestas distintas mismo cart → un confirmed; clave repetida/cuerpo distinto; crash antes/después de commit; lease vencido/fencing; replay después de TTL |
| Seguridad | JWT expirado/aud erróneo, membership revocada, BOLA, payload extra/oversize, prompt injection con fake total, SQLi, SSRF, salida logs sin PII/secrets, rate limits entre tenants |
| Handoff | pausa durante llamada IA, epoch invalida job; dos claims concurrentes; persona asignada puede responder, otra no; retorno reconstruye memoria; mensajes no activan bot |
| Proveedores | sandbox Meta texto/botón/ubicación/status y ventana/plantilla; OpenAI schema estricto, límites/tools erróneas; timeout ambiguo de envío no retry ciego |
| Rendimiento/recuperación | carga con cuotas por tenant, cola atrasada, restart worker, restore backup y latencia SLO; pruebas con datos sintéticos |

No escribir tests que únicamente reproduzcan implementación: pruebas de invariantes y fallos concurrentes son prioritarias. Tiempo/reloj y UUID inyectables; fixtures sintéticas; ninguna key real en tests. Herramientas futuras: test runner TypeScript, Postgres/Supabase local aislado y validador OpenAPI fijados con lockfile. CI incluirá typecheck, lint, unit/integration, contract, RLS e idempotencia antes de PR funcional.

## Verificación disponible de fase 1

`node scripts/build-openapi.mjs --check` comprueba que JSON generado coincide con fuente; `node scripts/validate-architecture.mjs` comprueba referencias locales, $ref, requisitos de contratos, enums compartidos y ausencia de valores secretos en .env.example. `git diff --check` comprueba whitespace. No existen tests backend ni DB hoy; estos checks documentales no prueban firma real, RLS, proveedor, concurrencia ni endpoints.
