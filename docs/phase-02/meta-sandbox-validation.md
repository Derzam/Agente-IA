# Fase 2.1 — Validación Meta WhatsApp sandbox

## Objetivo

Probar el webhook real de WhatsApp Cloud API con activos de prueba antes de implementar envío de mensajes, worker u OpenAI.

## Prerrequisitos

- Meta Developer App dedicada o autorizada para el proyecto.
- WhatsApp Business Account/test number.
- App Secret.
- Verify Token generado por nosotros.
- Callback URL HTTPS pública apuntando al backend de staging.
- Canal registrado en `app.whatsapp_channels` con el `phone_number_id` de prueba.

## Secuencia de validación

1. Publicar el backend de staging en HTTPS.
2. Configurar:
   - WHATSAPP_VERIFY_TOKEN
   - WHATSAPP_APP_SECRET
   - DATABASE_URL
   - WEBHOOK_DATABASE_URL
   - SUPABASE_URL
3. En Meta, registrar callback:
   - `GET /webhooks/whatsapp`
   - Meta envía `hub.mode`, `hub.verify_token`, `hub.challenge`.
4. Confirmar que el backend devuelve únicamente el challenge cuando el token coincide.
5. Suscribir el campo `messages`.
6. Enviar evento de prueba desde Meta.
7. Verificar firma `X-Hub-Signature-256` sobre raw body.
8. Confirmar inserción en `app.webhook_events`.
9. Reenviar el mismo evento y confirmar deduplicación.
10. Enviar:
    - mensaje text;
    - mensaje interactive si está disponible en test;
    - location;
    - status callback.
11. Confirmar canal desconocido:
    - responde 200;
    - no crea tenant/evento;
    - registra warning seguro.
12. Simular caída de DB:
    - backend responde 503;
    - no existe ACK falso.
13. Confirmar que no se registran:
    - App Secret;
    - tokens;
    - contenido sensible completo;
    - teléfonos sin necesidad.

## Fuera de alcance

- envío productivo;
- tokens permanentes;
- plantillas reales;
- número comercial real;
- OpenAI;
- procesamiento del worker;
- pedidos;
- pagos.

## Criterio de salida

Meta sandbox queda aprobado cuando:
- handshake GET real pasa;
- POST real firmado pasa;
- mensajes/statuses quedan persistidos;
- dedupe real funciona;
- error DB provoca retry;
- ningún secreto aparece en logs.
