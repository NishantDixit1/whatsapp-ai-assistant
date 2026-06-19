// ============================================================================
// THE AI BRAIN  -  shared by WhatsApp and voice. Runs a Groq (Llama) chat
// with two real "actions" (tools): book an appointment, and capture a lead.
// This is what makes it more than a chatbot: it completes tasks.
// Groq uses an OpenAI-compatible API (messages + tool calls).
// ============================================================================

import Groq from "groq-sdk";
import { business } from "./config.js";
import {
  getHistory,
  setHistory,
  saveLead,
  getActiveBooking,
  updateActiveBooking,
} from "./memory.js";
import { createEvent, updateEvent, deleteEvent } from "./calendar.js";
import { sendWhatsApp } from "./whatsapp.js";
import { friendlyTime, validateSlot } from "./util.js";

const TZ = () => process.env.BUSINESS_TIMEZONE || "America/Chicago";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
// Llama 3.3 70B supports tool calling and is fast on Groq (good for voice).
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function systemPrompt(channel) {
  const style =
    channel === "voice"
      ? "You are on a PHONE CALL. Keep replies short and natural, one or two sentences, like real speech. No emojis, no bullet points, no markdown."
      : "You are on WhatsApp. Keep replies short and friendly. A few emojis are fine. No long paragraphs.";

  const tz = process.env.BUSINESS_TIMEZONE || "America/Chicago";
  const now = new Date().toLocaleString("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `You are ${business.assistantName}, the assistant for ${business.name}, a ${business.industry}.
Your job: help the customer, answer their questions, and when they're ready, book an appointment or capture their details so the team can follow up.

The current date and time is ${now} (${tz}). Use this to turn requests like "tomorrow" or "Tuesday 3pm" into a concrete date and time. Only book within the business hours listed below.

${style}

BUSINESS KNOWLEDGE (only source of truth):
${business.knowledge}

OUR HOURS: ${business.hoursSummary}.

RULES:
${business.guardrails}
- Be warm and efficient. Don't repeat the greeting.
- To book, you need the customer's name, a specific day/time, and the reason. Ask for whatever is missing. When you have it, convert the time to start_iso in the format YYYY-MM-DDThh:mm:ss (24-hour, local time, no timezone suffix) and call book_appointment.
- The system enforces opening hours. If a tool tells you a slot is closed or invalid, DO NOT claim it's booked. Apologize, state the hours, and ask for a new time.
- If the customer wants to change an existing appointment, call reschedule_appointment (not book_appointment). If they want to cancel, call cancel_appointment.
- If they're not ready to book but are interested, call capture_lead so the team can reach out.
- After a successful booking, reschedule, or cancellation, the customer automatically receives a confirmation message with the exact date and time. So keep your own reply to ONE short sentence, and NEVER state the day of the week or the date yourself (you may get it wrong) - the confirmation already shows it.`;
}

// OpenAI/Groq tool format: { type: "function", function: { name, description, parameters } }
const tools = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Book an appointment (creates a real calendar event) once you have the customer's name, a specific start time, and the reason for the visit.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer's full name" },
          start_iso: {
            type: "string",
            description:
              "Start time as YYYY-MM-DDThh:mm:ss in 24-hour local time, no timezone suffix. e.g. 2026-06-23T15:00:00",
          },
          duration_minutes: {
            type: "integer",
            description: "Appointment length in minutes. Default 30 if unknown.",
          },
          reason: { type: "string", description: "Reason for the visit" },
          notes: { type: "string", description: "Any other useful detail" },
        },
        required: ["name", "start_iso", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description:
        "Change the time (and optionally the reason) of the customer's existing appointment. Use this instead of book_appointment when they want to move an appointment.",
      parameters: {
        type: "object",
        properties: {
          start_iso: {
            type: "string",
            description:
              "New start time as YYYY-MM-DDThh:mm:ss in 24-hour local time, no timezone suffix.",
          },
          duration_minutes: {
            type: "integer",
            description: "Appointment length in minutes. Default 30 if unknown.",
          },
          reason: { type: "string", description: "Updated reason, if it changed" },
        },
        required: ["start_iso"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancel the customer's existing appointment.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why they're cancelling, if given" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_lead",
      description:
        "Save an interested customer's details when they are NOT ready to book yet, so the team can follow up.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer's name if given" },
          interest: { type: "string", description: "What they're interested in" },
          notes: { type: "string", description: "Any other useful detail" },
        },
        required: ["interest"],
      },
    },
  },
];

// Send a WhatsApp message to the customer, swallowing errors so a failed
// notification never breaks the booking. Returns true if sent.
async function notify(contact, body) {
  try {
    const sid = await sendWhatsApp(contact, body);
    if (sid) console.log(`[whatsapp] message sent to ${contact} (${sid})`);
    return Boolean(sid);
  } catch (err) {
    console.error(`[whatsapp] send failed for ${contact}:`, err.message);
    return false;
  }
}

function bookingCard(title, name, startIso, reason) {
  return (
    `${title} at ${business.name}!\n\n` +
    `👤 ${name}\n` +
    `🗓️ ${friendlyTime(startIso)}\n` +
    `📋 ${reason || "your visit"}\n\n` +
    `Need to change it? Just reply here. See you then!`
  );
}

async function runTool(name, input, ctx) {
  // --- capture a lead -------------------------------------------------------
  if (name === "capture_lead") {
    saveLead({
      type: name,
      contact: ctx.contactId,
      channel: ctx.channel,
      createdAt: new Date().toISOString(),
      ...input,
    });
    console.log(`[action] capture_lead for ${ctx.contactId}:`, input);
    return `Lead saved for follow-up: ${input.interest}. The team will reach out.`;
  }

  // --- cancel an appointment ------------------------------------------------
  if (name === "cancel_appointment") {
    const existing = getActiveBooking(ctx.contactId);
    if (!existing) return "There is no active appointment on file to cancel.";

    if (existing.calendarEventId) {
      try {
        await deleteEvent(existing.calendarEventId);
      } catch (err) {
        console.error("[calendar] delete failed:", err.message);
      }
    }
    updateActiveBooking(ctx.contactId, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelReason: input.reason || null,
    });
    await notify(
      ctx.contactId,
      `❌ Your appointment at ${business.name} on ${friendlyTime(existing.start_iso)} has been cancelled. Reply any time to book again.`
    );
    console.log(`[action] cancel_appointment for ${ctx.contactId}`);
    return "The appointment has been cancelled and the customer notified.";
  }

  // --- book or reschedule (both validate hours the same way) ----------------
  const durationMinutes = input.duration_minutes || 30;
  const slot = validateSlot(input.start_iso, business.hours, durationMinutes, TZ());
  if (!slot.ok) {
    // Do NOT book or notify. Tell the model so it asks for another time.
    console.log(`[action] ${name} rejected for ${ctx.contactId}: ${slot.reason} (${input.start_iso})`);
    return `Cannot book that slot: ${slot.reason}. Our hours are ${business.hoursSummary}. Apologize and ask the customer for a different time within our hours. Do not say it is booked.`;
  }

  if (name === "reschedule_appointment") {
    const existing = getActiveBooking(ctx.contactId);
    if (!existing) {
      return "There is no existing appointment to reschedule. Ask if they'd like to book a new one.";
    }
    const reason = input.reason || existing.reason;

    let calendar = null;
    if (existing.calendarEventId) {
      try {
        calendar = await updateEvent(existing.calendarEventId, {
          name: existing.name,
          startIso: input.start_iso,
          durationMinutes,
          reason,
        });
      } catch (err) {
        console.error("[calendar] update failed:", err.message);
      }
    }

    updateActiveBooking(ctx.contactId, {
      start_iso: input.start_iso,
      duration_minutes: durationMinutes,
      reason,
      rescheduledAt: new Date().toISOString(),
      calendarLink: calendar?.htmlLink || existing.calendarLink || null,
    });
    await notify(ctx.contactId, bookingCard("🔄 Your appointment is updated", existing.name, input.start_iso, reason));
    console.log(`[action] reschedule_appointment for ${ctx.contactId}: ${input.start_iso}`);
    return `Rescheduled to ${input.start_iso}. The customer has been sent an updated confirmation.`;
  }

  // name === "book_appointment"
  let calendar = null;
  try {
    calendar = await createEvent({
      name: input.name,
      startIso: input.start_iso,
      durationMinutes,
      reason: input.reason,
      notes: input.notes,
      contact: ctx.contactId,
    });
  } catch (err) {
    console.error("[calendar] failed to create event:", err.message);
  }

  const confirmationSent = await notify(
    ctx.contactId,
    bookingCard("✅ You're booked", input.name, input.start_iso, input.reason)
  );

  saveLead({
    type: "book_appointment",
    contact: ctx.contactId,
    channel: ctx.channel,
    createdAt: new Date().toISOString(),
    status: "active",
    name: input.name,
    start_iso: input.start_iso,
    duration_minutes: durationMinutes,
    reason: input.reason,
    notes: input.notes || null,
    calendarEventId: calendar?.id || null,
    calendarLink: calendar?.htmlLink || null,
    confirmationSent,
  });
  console.log(`[action] book_appointment for ${ctx.contactId}: ${input.start_iso}`, calendar ? "(calendar event created)" : "(saved to file only)");

  return `Booked for ${input.start_iso}. The customer has been sent a confirmation. Reply with one short sentence.`;
}

// Main entry: take a user message, return the assistant's text reply.
// channel is "voice" or "whatsapp". id is the contact's phone number.
// `history` holds user/assistant/tool messages (no system); we prepend a fresh
// system prompt each call so the current date/time is always accurate.
export async function getReply({ id, channel, userText }) {
  const history = getHistory(id);
  history.push({ role: "user", content: userText });

  // Tool loop: let the model call tools until it returns a final text reply.
  for (let i = 0; i < 5; i++) {
    const res = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      tools,
      tool_choice: "auto",
      messages: [{ role: "system", content: systemPrompt(channel) }, ...history],
    });

    const msg = res.choices[0].message;
    history.push(msg); // assistant message (may carry tool_calls)

    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const output = await runTool(call.function.name, args, { contactId: id, channel });
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: output,
        });
      }
      continue; // let the model respond now that the action is done
    }

    // Final text reply.
    const text = (msg.content || "").trim();
    setHistory(id, history);
    return text || "Sorry, could you say that again?";
  }

  setHistory(id, history);
  return "Let me get a team member to help you with that.";
}
