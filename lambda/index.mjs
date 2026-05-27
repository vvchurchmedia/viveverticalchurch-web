import { readFileSync } from "node:fs";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "Vive Vertical Church <info@viveverticalchurch.com>";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "info@viveverticalchurch.com";

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

function buildNotificationEmail(name, email, phone, address, interests) {
  return {
    subject: `Nuevo visitante: ${name}`,
    html: renderTemplate(notificationTemplate, {
      name,
      email,
      phone: phone || "No proporcionado",
      address: address || "No proporcionada",
      interests: interests && interests.length > 0 ? interests.join(", ") : "Ninguno seleccionado",
    }),
  };
}

async function sendEmail({ from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend error (${res.status}): ${error}`);
  }

  return res.json();
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
    const { website, name, email, phone, address, interests } = body;

    // Honeypot check — bots fill this hidden field, humans don't
    if (website) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: "Mensaje enviado correctamente." }),
      };
    }

    if (!name || !email) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Nombre y correo son requeridos." }),
      };
    }

    const tasks = [];

    // Send welcome email to the person
    const welcomeEmail = buildWelcomeEmail(name);
    tasks.push(
      sendEmail({
        from: FROM_EMAIL,
        to: email,
        subject: welcomeEmail.subject,
        html: welcomeEmail.html,
      })
    );

    // Send notification email to the church
    const notification = buildNotificationEmail(name, email, phone, address, interests);
    tasks.push(
      sendEmail({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        subject: notification.subject,
        html: notification.html,
      })
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
