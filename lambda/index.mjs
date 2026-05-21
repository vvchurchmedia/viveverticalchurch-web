import { readFileSync } from "node:fs";
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

const welcomeTemplate = readFileSync(new URL("./templates/welcome.html", import.meta.url), "utf-8");
const notificationTemplate = readFileSync(new URL("./templates/notification.html", import.meta.url), "utf-8");

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function buildWelcomeEmail(name) {
  return {
    subject: "Bienvenido a Vive Vertical Church",
    html: renderTemplate(welcomeTemplate, { name }),
  };
}

function buildWelcomeSms(name) {
  return (
    `¡Hola ${name}! Gracias por comunicarte con Vive Vertical Church. ` +
    `Te invitamos este sábado a las 10:45AM - 830 Mayfield Rd, Unit 560, Grand Prairie, TX 75052. ` +
    `Visita www.viveverticalchurch.com - ¡Te esperamos!`
  );
}

function buildNotificationEmail(name, email, phone, message) {
  return {
    subject: `Nuevo contacto: ${name}`,
    html: renderTemplate(notificationTemplate, {
      name,
      email,
      phone: phone || "No proporcionado",
      message,
    }),
  };
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
    const { website, name, email, phone, message } = body;

    // Honeypot check — bots fill this hidden field, humans don't
    if (website) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: "Mensaje enviado correctamente." }),
      };
    }

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
