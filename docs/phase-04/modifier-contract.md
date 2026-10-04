# Contrato de modificadores para Antigravity

Fase 4 extiende shared y OpenAPI 0.4.0 en [PR #12](https://github.com/Derzam/Agente-IA/pull/12). La persistencia sigue siendo modifier_groups → modifier_options; no hay product_options ni almacenamiento duplicado de los modificadores.

Base: `/v1/businesses/{business_id}/products/{product_id}`.

| Método | Ruta | Request | Response |
|---|---|---|---|
| GET | /modifier-groups | cursor/limit | ModifierGroupPage |
| POST | /modifier-groups | ModifierGroupInput | 201 ModifierGroupResponse |
| PATCH | /modifier-groups/{group_id} | ModifierGroupUpdate + expected_version del grupo | 200 ModifierGroupResponse |
| DELETE | /modifier-groups/{group_id} | expected_version query | 204 |
| GET | /modifier-groups/{group_id}/options | cursor/limit | ModifierOptionPage |
| POST | /modifier-groups/{group_id}/options | ModifierOptionInput | 201 ModifierOptionResponse |
| PATCH | /modifier-groups/{group_id}/options/{option_id} | ModifierOptionUpdate + expected_version de opción | 200 ModifierOptionResponse |
| DELETE | /modifier-groups/{group_id}/options/{option_id} | expected_version query | 204 |

JWT y autorización tenant en todas; lectura owner/manager/operator; mutación manager/owner, Idempotency-Key UUID obligatoria. IDs parent/child deben corresponder: recurso ajeno retorna 404. VERSION_CONFLICT no se soluciona reintentando automáticamente con una nueva versión; refrescar y pedir decisión.

ModifierGroup contiene Entity + product_id/name/required/min_select/max_select/sort_order/active. ModifierOption contiene Entity + modifier_group_id/name/price_delta_minor/available/sort_order. Versiones independientes. Required exige min_select>=1; 0<=min<=max<=99. Hasta 99 grupos vivos/producto y 99 opciones/grupo; durante compatibilidad, 100 opciones vivas/producto. Soft delete oculta recursos; los snapshots históricos permanecen.

Product incorpora `modifier_groups?: (ModifierGroup & {options:ModifierOption[]})[]`, incluyendo grupos vacíos. El backend lo devuelve; opcional en shared/OpenAPI para conservar fixtures/adaptadores existentes. `options:ProductOption[]` sigue presente temporalmente, derivado de datos reales. group_key es el UUID del grupo; version es la versión de opción. No usar esa versión para editar reglas del grupo.

Las tres rutas legacy /options están deprecated en OpenAPI. Permiten crear/editar/borrar una opción real; crear con group_key textual puede crear un grupo nuevo con las reglas solicitadas. Si existe el grupo, sus reglas deben coincidir. PATCH legacy que cambia reglas compartidas o reasigna group_key retorna 422: usar la ruta del grupo con su CAS. El puente no actualiza silenciosamente otros modificadores. Creación de grupos legacy también queda auditada.

Plan de consumo: adaptar formulario a grupos explícitos, mantener los IDs y versiones independientes, usar rutas anidadas, paginar y manejar errores de CAS/idempotencia. Tras integrar ese consumidor, acordar retirada versionada de rutas/DTO legacy; la deprecación no es permanente. Esta entrega publica el contrato y ejemplos para la coordinación; no modifica componentes visuales ni envía mensajes a otra herramienta.

Settings también incorpora tax_policy opcional/nullable, documentada en [implementation.md](implementation.md). Los clientes actuales pueden ignorarla; no se añade una tasa al negocio de forma implícita. ai_enabled es persistencia de configuración, sin ejecución IA.
