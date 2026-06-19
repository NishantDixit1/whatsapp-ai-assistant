// ============================================================================
// OUTBOUND WHATSAPP  -  send a message to a customer proactively (e.g. a
// booking confirmation), using Twilio's REST API.
//
// IMPORTANT (WhatsApp rule): you can only send free-form text within 24 hours
// of the customer's last message to you. Outside that window (e.g. confirming
// a booking taken over a PHONE CALL where they never messaged you), WhatsApp
// requires a pre-approved MESSAGE TEMPLATE. For the Twilio sandbox and for
// customers who just chatted, free-form works fine. In production, register a
// "booking_confirmation" template and send it via contentSid instead.
// ============================================================================

import twilio from "twilio";

let cachedClient = null;

export function whatsappConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
  );
}

function getClient() {
  if (cachedClient) return cachedClient;
  if (!whatsappConfigured()) return null;
  cachedClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return cachedClient;
}

// Send a WhatsApp message. `to` may be a bare number ("+1555...") or already
// prefixed ("whatsapp:+1555..."). Returns the message SID, or null if not
// configured. Throws on a real Twilio error so the caller can log it.
export async function sendWhatsApp(to, body) {
  const client = getClient();
  if (!client) return null;
  const toAddr = String(to).startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const msg = await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: toAddr,
    body,
  });
  return msg.sid;
}
