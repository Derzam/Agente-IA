import type { FastifyInstance } from "fastify";

// Public notice for the authorized staging service. No tenant or request data
// is interpolated; this content ships with the API build and needs no DB access.
const privacyPage = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Política de privacidad de Agente-IA para sus pruebas de integración con WhatsApp Cloud API.">
  <title>Política de privacidad | Agente-IA</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; color: #172b36; background: #f4f7f8; }
    * { box-sizing: border-box; }
    body { margin: 0; line-height: 1.65; }
    main { max-width: 850px; margin: 0 auto; padding: 36px 24px 64px; }
    header { border-bottom: 2px solid #20705f; padding-bottom: 24px; }
    h1 { line-height: 1.2; font-size: clamp(2rem, 6vw, 3rem); margin: 12px 0; }
    h2 { font-size: 1.35rem; line-height: 1.35; margin-top: 32px; }
    a { color: #075c50; overflow-wrap: anywhere; text-underline-offset: .2em; }
    a:focus-visible { outline: 3px solid #20705f; outline-offset: 4px; }
    .label { font-weight: 700; color: #075c50; }
    .notice { padding: 16px 20px; background: #e3efeb; border-left: 4px solid #20705f; margin-top: 24px; }
    li { margin-bottom: 8px; }
    footer { margin-top: 40px; border-top: 1px solid #c9d6db; padding-top: 20px; }
  </style>
</head>
<body>
<main>
  <header>
    <span class="label">Agente-IA · entorno de pruebas</span>
    <h1>Política de privacidad</h1>
    <p>Vigente desde el <time datetime="2026-10-05">5 de octubre de 2026</time>. Versión 1.0.</p>
    <p>Esta política explica cómo Agente-IA trata información en sus pruebas de integración con WhatsApp Cloud API de Meta y cuando visitas esta página.</p>
  </header>

  <section aria-labelledby="responsable">
    <h2 id="responsable">1. Responsable y contacto</h2>
    <p>El responsable de Agente-IA en este entorno es <strong>Derly Zambrano</strong>. Para consultas de privacidad o solicitudes sobre tus datos escribe a <a href="mailto:derlymoreira192@gmail.com">derlymoreira192@gmail.com</a>, con el asunto “Privacidad Agente-IA”.</p>
    <p>Esta política corresponde exclusivamente a Agente-IA y a su aplicación Agente-IA Staging. No cubre servicios de otros negocios ni sustituye las políticas de WhatsApp o Meta.</p>
  </section>

  <section aria-labelledby="alcance">
    <h2 id="alcance">2. Alcance de las pruebas</h2>
    <p>Agente-IA está en desarrollo para apoyar la atención y gestión de pedidos de negocios de comida. El entorno descrito aquí se utiliza con participantes y números de prueba autorizados para comprobar la recepción, persistencia y procesamiento de eventos de WhatsApp.</p>
    <div class="notice">En esta etapa no se atienden clientes reales, no se aceptan pedidos ni pagos y están desactivados tanto el envío automático de respuestas desde Agente-IA como el procesamiento de conversaciones con OpenAI. Un mensaje de demostración enviado desde el panel de Meta no implica que estas funciones estén activas.</div>
    <p>No envíes contraseñas, códigos de verificación, documentos de identidad, información bancaria, datos de salud ni información de terceros. Tampoco necesitamos una dirección de entrega para estas pruebas. Las pruebas no están dirigidas a menores de edad.</p>
  </section>

  <section aria-labelledby="datos">
    <h2 id="datos">3. Información que podemos recibir</h2>
    <ul>
      <li><strong>Identificación del canal y del participante:</strong> identificador de usuario de WhatsApp, que puede corresponder a tu número de teléfono, e identificadores internos que vinculan al participante con su conversación.</li>
      <li><strong>Contenido enviado:</strong> texto del mensaje, selección de elementos interactivos y, si la compartes, ubicación con coordenadas y texto asociado. El sistema actual no descarga archivos multimedia recibidos; los tipos no compatibles se registran de forma limitada.</li>
      <li><strong>Metadatos:</strong> identificadores de mensajes y eventos del proveedor, fechas, tipo de evento, estados de envío, entrega, lectura o fallo y códigos de error, cuando Meta los comunica.</li>
      <li><strong>Datos técnicos:</strong> la infraestructura recibe datos de conexión, incluida la dirección IP. Los registros de aplicación contienen identificadores técnicos, ruta solicitada, estado HTTP, tiempos y contadores; excluyen cuerpos de mensajes, teléfonos completos, direcciones y credenciales.</li>
      <li><strong>Solicitudes de privacidad:</strong> dirección de correo y la información mínima que aportes para identificar tu solicitud.</li>
    </ul>
    <p>No solicitamos acceso a tu agenda completa, historial de otros chats ni datos de otros negocios. No conservamos el webhook completo sin filtrar: extraemos los campos necesarios. El contenido que envíes puede quedar en los registros de mensajes del servicio aunque se excluya de los logs técnicos.</p>
  </section>

  <section aria-labelledby="finalidades">
    <h2 id="finalidades">4. Finalidades y participación</h2>
    <p>Usamos los datos para ejecutar las pruebas que has autorizado, asociar mensajes con la conversación correcta, evitar procesamiento duplicado, verificar estados comunicados por Meta, diagnosticar errores sin exponer el contenido y proteger el servicio frente a abuso.</p>
    <p>La participación en las pruebas es voluntaria y se limita a personas previamente autorizadas. Puedes dejar de participar y pedir que cesen las comunicaciones o se eliminen tus datos mediante el contacto indicado. Enviar un mensaje no constituye una autorización general para marketing ni para nuevas finalidades.</p>
    <p>No vendemos los datos, no los usamos para publicidad dirigida ni compartimos conversaciones entre participantes o negocios. Esta página no incorpora cookies de analítica, píxeles publicitarios, formularios ni scripts de seguimiento.</p>
  </section>

  <section aria-labelledby="proveedores">
    <h2 id="proveedores">5. Proveedores y acceso</h2>
    <p><strong>Meta y WhatsApp</strong> intervienen en el transporte de mensajes y eventos de WhatsApp Cloud API. <strong>Railway</strong> aloja el API y el proceso de trabajo de staging. <strong>Supabase</strong> aloja la base de datos exclusiva de staging. Estos proveedores pueden tratar información técnica y los datos necesarios para prestar sus servicios, conforme a sus contratos y políticas.</p>
    <p>El responsable y el personal técnico expresamente autorizado pueden acceder a la información necesaria para operar las pruebas y atender solicitudes, con acceso restringido por función y negocio. También puede ser necesario comunicar información para cumplir una obligación legal aplicable; cualquier comunicación se limita a lo requerido.</p>
    <p>El uso de proveedores externos puede implicar tratamiento o almacenamiento fuera de tu país. No afirmamos una residencia local exclusiva. Puedes consultar <a href="https://www.whatsapp.com/legal/privacy-policy">la política de privacidad de WhatsApp</a>, <a href="https://www.facebook.com/privacy/policy/">la política de privacidad de Meta</a>, <a href="https://railway.com/legal/privacy">la política de privacidad de Railway</a> y <a href="https://supabase.com/privacy">la política de privacidad de Supabase</a>.</p>
  </section>

  <section aria-labelledby="ia">
    <h2 id="ia">6. Inteligencia artificial</h2>
    <p>El procesamiento con OpenAI está desactivado en esta etapa: Agente-IA no envía estas conversaciones a OpenAI. Antes de activarlo se actualizará este aviso para explicar su finalidad, la información enviada y las condiciones de tratamiento y retención del proveedor, y se obtendrán las autorizaciones que correspondan.</p>
    <p>La arquitectura prevista reduce el contexto al mínimo necesario y separa el modelo de los servicios que calculan precios o validan pedidos. No se tomarán decisiones sobre pagos ni se confirmarán pedidos únicamente por una respuesta del modelo.</p>
  </section>

  <section aria-labelledby="conservacion">
    <h2 id="conservacion">7. Conservación y eliminación</h2>
    <p>Conservamos información solo mientras sea necesaria para las pruebas, su diagnóstico, la seguridad y las obligaciones aplicables. Al finalizar las pruebas, el responsable revisará los datos para eliminarlos o anonimizarlos cuando ya no sean necesarios. La eliminación en staging se gestiona manualmente; actualmente no hay una purga automática que garantice un plazo fijo.</p>
    <p>Los identificadores técnicos necesarios para evitar duplicados o investigar incidentes pueden conservarse de forma separada y minimizada durante el periodo necesario. Si una obligación legal exige conservar información, se limitará su uso a esa obligación y se explicará la limitación al atender tu solicitud.</p>
    <p>Las copias de seguridad y los registros gestionados por los proveedores tienen sus propios ciclos de conservación. La eliminación de la base activa no significa que todas las copias se borren inmediatamente. No utilizaremos una restauración para reactivar comunicaciones o tratamientos retirados.</p>
  </section>

  <section aria-labelledby="derechos">
    <h2 id="derechos">8. Tus derechos y cómo solicitar la eliminación</h2>
    <p>Puedes solicitar información sobre tus datos, acceso, corrección, eliminación, oposición o limitación del tratamiento y retirar tu autorización para las pruebas. Cuando corresponda según la legislación aplicable, también puedes solicitar portabilidad y presentar una reclamación ante la autoridad de protección de datos competente.</p>
    <ol>
      <li>Escribe a <a href="mailto:derlymoreira192@gmail.com">derlymoreira192@gmail.com</a> con el asunto “Privacidad Agente-IA” o “Eliminar mis datos de Agente-IA”.</li>
      <li>Indica qué solicitas y la fecha aproximada de tu participación. No adjuntes contraseñas, tokens, códigos de WhatsApp ni documentos sensibles.</li>
      <li>El responsable te pedirá, solo si hace falta, información mínima para verificar que los datos te pertenecen y evitar entregarlos o borrarlos a petición de otra persona.</li>
      <li>Tras la verificación, se tramitará manualmente la solicitud y se te comunicará el resultado, las limitaciones justificadas y, si corresponde, la conservación pendiente en copias de seguridad, dentro de los plazos exigidos por la legislación aplicable.</li>
    </ol>
    <p>Esta solicitud se refiere a los datos tratados por Agente-IA. Para gestionar datos o tu cuenta directamente en WhatsApp o Meta debes utilizar también los controles y canales de esos proveedores.</p>
  </section>

  <section aria-labelledby="seguridad">
    <h2 id="seguridad">9. Seguridad</h2>
    <p>El servicio usa HTTPS, valida las firmas de los webhooks de Meta y restringe el acceso a la base de datos mediante roles y aislamiento por negocio. Las credenciales se gestionan fuera del código y los logs de aplicación excluyen contenido sensible. Estas medidas reducen riesgos, pero ningún sistema puede garantizar seguridad absoluta.</p>
    <p>Si detectas una posible exposición de datos, informa al contacto de privacidad sin enviar secretos ni reproducir información de terceros.</p>
  </section>

  <section aria-labelledby="cambios">
    <h2 id="cambios">10. Cambios de esta política</h2>
    <p>Publicaremos las revisiones en esta misma URL, indicando la fecha y la versión. Cualquier paso a producción, activación de IA, atención comercial, nuevos destinatarios o cambio relevante de finalidad requiere revisar este aviso y comunicarlo a los participantes antes de aplicar ese tratamiento.</p>
  </section>
  <footer>Agente-IA · Política exclusiva del entorno de staging · Contacto: <a href="mailto:derlymoreira192@gmail.com">derlymoreira192@gmail.com</a></footer>
</main>
</body>
</html>`;

export function registerPrivacyRoute(app: FastifyInstance) {
  app.get("/privacy", async (_request, reply) =>
    reply
      .header("Cache-Control", "no-cache")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      .type("text/html; charset=utf-8")
      .send(privacyPage),
  );
}
