# Modificadores: persistencia canónica y API temporal

Decisión cerrada: modifier_groups + modifier_options. product_options fue un diseño preliminar sin tabla aplicada y no se crea ni se recrea. Cada grupo pertenece a un producto; cada opción pertenece a un grupo, con FKs compuestas por business_id. Nombre único normalizado entre filas no eliminadas, cardinalidad del grupo y deltas bigint no negativos.

Los schemas ProductOption/ProductOptionInput/ProductOptionUpdate en docs/api/openapi.json y packages/shared/src/index.ts permanecen idénticos a main 6060d6b. apps/admin tampoco cambia. Las rutas públicas /products/{product_id}/options siguen PLANNED. Esta fase no implementa adaptadores ni cambia silenciosamente una respuesta del frontend.

Proyección futura de lectura propuesta (requiere coordinación con Antigravity): id=modifier_options.id; product_id=modifier_groups.product_id; group_key=modifier_groups.id como UUID estable, no nombre mutable; required/min_select/max_select proceden del grupo; name/price_delta_minor/available y version proceden de la opción. Mostrar solo opciones/grupos/productos no eliminados. Los grupos sin opciones requieren un DTO explícito, pues el contrato plano no puede representarlos.

Incompatibilidad de escritura a resolver antes de habilitar las rutas: el contrato antiguo permite cambiar required/min_select/max_select desde una opción y dispone de un solo expected_version. Ahora esos campos son compartidos por todo el grupo, que tiene su propia versión. No basta comparar version de la opción. Acordar DTOs/rutas de grupos y versiones independientes, o un comando transaccional de compatibilidad con control explícito de ambas versiones; nunca actualizar todos los grupos por group_key de texto ni aceptar cambios inconsistentes. También acordar creación de grupos vacíos, orden y borrado lógico.

La coordinación queda documentada como siguiente trabajo, sin enviar mensajes a otros agentes ni modificar los contratos públicos. No bloquea el esquema persistente de esta fase.
