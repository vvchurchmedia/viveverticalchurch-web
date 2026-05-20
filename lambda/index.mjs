import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const ses = new SESClient();
const sns = new SNSClient();

const FROM_EMAIL = "info@viveverticalchurch.com";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || FROM_EMAIL;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://www.viveverticalchurch.com",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function buildWelcomeEmail(name) {
  const subject = "Bienvenido a Vive Vertical Church";
  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #4F5655;">
      <div style="background-color: #14261C; padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Vive Vertical Church</h1>
      </div>
      <div style="padding: 40px 30px;">
        <h2 style="color: #14261C; margin-top: 0;">Hola ${name},</h2>
        <p style="font-size: 16px; line-height: 1.6;">
          Gracias por comunicarte con nosotros. Nos alegra mucho saber de ti.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">
          Nuestro equipo revisara tu mensaje y te responderemos lo mas pronto posible.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">
          Te invitamos a visitarnos este domingo:
        </p>
        <div style="background-color: #f7f9f8; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0; font-size: 16px;"><strong>Domingos 11:00 AM</strong></p>
          <p style="margin: 8px 0 0; font-size: 16px;">830 Mayfield Rd, Unit 560</p>
          <p style="margin: 4px 0 0; font-size: 16px;">Grand Prairie, TX 75052</p>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">
          Siguenos en nuestras redes sociales para mantenerte conectado:
        </p>
        <p style="font-size: 16px;">
          <a href="https://www.facebook.com/profile.php?id=61552775499711" style="color: #42b58c; text-decoration: none;">Facebook</a> &nbsp;|&nbsp;
          <a href="https://instagram.com/viveverticalchurch" style="color: #42b58c; text-decoration: none;">Instagram</a> &nbsp;|&nbsp;
          <a href="https://www.youtube.com/@viveverticalchurch" style="color: #42b58c; text-decoration: none;">YouTube</a>
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin-top: 24px;">
          Con carino,<br />
          <strong>Vive Vertical Church</strong>
        </p>
      </div>
      <div style="background-color: #f7f9f8; padding: 20px; text-align: center; font-size: 13px; color: #9CA3A0;">
        <p style="margin: 0;">Vive Vertical Church &bull; 830 Mayfield Rd, Unit 560, Grand Prairie, TX 75052</p>
      </div>
    </div>
  `;

  return { subject, html };
}

function buildWelcomeSms(name) {
  return (
    `Hola ${name}! Gracias por comunicarte con Vive Vertical Church. ` +
    `Te invitamos este domingo a las 11AM - 830 Mayfield Rd, Unit 560, Grand Prairie, TX 75052. ` +
    `Te esperamos!`
  );
}

function buildNotificationEmail(name, email, phone, message) {
  const subject = `Nuevo contacto: ${name}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; color: #333;">
      <h2 style="color: #14261C;">Nuevo mensaje de contacto</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; font-weight: bold;">Nombre:</td><td style="padding: 8px;">${name}</td></tr>
        <tr><td style="padding: 8px; font-weight: bold;">Correo:</td><td style="padding: 8px;">${email}</td></tr>
        <tr><td style="padding: 8px; font-weight: bold;">Telefono:</td><td style="padding: 8px;">${phone || "No proporcionado"}</td></tr>
      </table>
      <div style="background-color: #f7f9f8; border-radius: 8px; padding: 16px; margin-top: 16px;">
        <p style="font-weight: bold; margin-top: 0;">Mensaje:</p>
        <p style="white-space: pre-wrap;">${message}</p>
      </div>
    </div>
  `;

  return { subject, html };
}

function formatPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.startsWith("+")) return phone;
  return null;
}

export async function handler(event) {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS };
  }

  try {
    const body = JSON.parse(event.body);
    const { name, email, phone, message } = body;

    if (!name || !email || !message) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Nombre, correo y mensaje son requeridos." }),
      };
    }

    const tasks = [];

    // Send welcome email to the person
    const welcomeEmail = buildWelcomeEmail(name);
    tasks.push(
      ses.send(
        new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: welcomeEmail.subject },
            Body: { Html: { Data: welcomeEmail.html } },
          },
        })
      )
    );

    // Send notification email to the church
    const notification = buildNotificationEmail(name, email, phone, message);
    tasks.push(
      ses.send(
        new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [NOTIFY_EMAIL] },
          Message: {
            Subject: { Data: notification.subject },
            Body: { Html: { Data: notification.html } },
          },
        })
      )
    );

    // Send welcome SMS if phone number provided
    if (phone) {
      const formattedPhone = formatPhone(phone);
      if (formattedPhone) {
        const smsMessage = buildWelcomeSms(name);
        tasks.push(
          sns.send(
            new PublishCommand({
              PhoneNumber: formattedPhone,
              Message: smsMessage,
            })
          )
        );
      }
    }

    await Promise.all(tasks);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Mensaje enviado correctamente." }),
    };
  } catch (error) {
    console.error("Error processing contact form:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Error al enviar el mensaje." }),
    };
  }
}
