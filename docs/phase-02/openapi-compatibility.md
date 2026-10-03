# Compatibilidad de fase 2 con OpenAPI

No se cambian los schemas canónicos Me, Membership, Business, ApiError ni enums/lifecycle. `/v1/me` devuelve IDs de negocio y roles activos, no nombres adicionales; un usuario sin membership es200 con memberships[]. GET business ya formaba parte del contrato y permite probar aislamiento sin agregar ruta ad-hoc. Recurso ajeno→404; paths UUID malformados→422. Los errores mantienen code/message/details/retryable/meta.request_id.

## Extensión justificada v0.1.1 (generador + openapi.json)

Problema: fase1 no describía probes /health y /ready, y webhook no incluía rate-limit429 o error interno500, aunque fase2 requiere estas defensas. Se agregan explícitamente:

- GET /health:200 `{status: "ok"}` y500 seguro.
- GET /ready:200 `{status: "ready"}`,503 con ApiError cuando DB/roles/esquema no disponibles y500 seguro.
- GET/POST /webhooks/whatsapp:429 referencia Error429 y500 Error500; se conservan todos los códigos/challenge/cuerpo raw anteriores.
- `x-implementation-status` por operación: seis IMPLEMENTED y35 PLANNED. No servers públicos ficticios.

El conteo pasa39→41 por los dos probes. validate-architecture conserva los checks de fase1 y ajusta las dos exclusiones nuevas; contract tests usan JSON Schema2020-12/Ajv sobre los schemas canónicos y respuestas HTTP. La extensión añade respuestas operativas; no elimina campos ni modifica el flujo de pedidos. El panel debe aplicar su manejo normal de429/503 y no inferir disponibilidad de las35 rutas PLANNED.

Health y ready son interfaces operativas, por eso usan un cuerpo mínimo sin envelope de recurso; todos los errores siguen ApiError. Meta ACK no tenía cuerpo canónico y ahora responde `{status: "received"}` después del commit. HTTP para media types no soportados se normaliza a400 VALIDATION_ERROR. Los success schemas v0.1 se mantienen intactos.

## Limitaciones explícitas

JWKS asimétrica no soporta HS256 legado; se registra como limitación de configuración Supabase, no cambio del bearer contract. No endpoints de login nuevos, no frontend Auth conectado. Un usuario con>100 memberships provoca503 en /me por maxItems=100 del schema; se debe diseñar paginación antes de operar esa escala. No se trunca lista ni cambia contrato silenciosamente.
