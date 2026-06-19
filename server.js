// ============================================================================
// SERVER  -  Twilio webhooks for WhatsApp + phone calls, both routed to the
// same Claude brain (src/ai.js) with shared memory (src/memory.js).
//
//   POST /whatsapp        Twilio WhatsApp inbound messages
//   POST /voice           Twilio incoming phone call (greeting + listen)
//   POST /voice/respond   Twilio sends the caller's speech here; AI replies
//   GET  /health          health check
// ============================================================================

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import twilio from "twilio";
import { getReply } from "./src/ai.js";
import { contactId, getHistory, readLeads } from "./src/memory.js";
import { business } from "./src/config.js";
import { checkReminders } from "./src/reminders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { MessagingResponse, VoiceResponse } = twilio.twiml;
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public"))); // serves the web page at /

app.get("/health", (_req, res) => res.send("ok"));

// Public business info for the web page (no secrets).
app.get("/api/info", (_req, res) => {
  res.json({
    name: business.name,
    assistantName: business.assistantName,
    whatsappNumber: business.whatsappNumber,
    phoneNumber: business.phoneNumber,
    sandboxJoinCode: business.sandboxJoinCode || null,
    hoursSummary: business.hoursSummary,
  });
});

// Bookings + leads for the live dashboard.
app.get("/api/leads", (_req, res) => {
  res.json(readLeads());
});

// --- WhatsApp ---------------------------------------------------------------
app.post("/whatsapp", async (req, res) => {
  const from = req.body.From; // e.g. "whatsapp:+15551234567"
  const body = (req.body.Body || "").trim();
  const id = contactId(from);
  const twiml = new MessagingResponse();

  try {
    // First contact ever on this number? Greet them.
    if (getHistory(id).length === 0 && !body) {
      twiml.message(business.whatsappGreeting);
    } else {
      const reply = await getReply({ id, channel: "whatsapp", userText: body });
      twiml.message(reply);
    }
  } catch (err) {
    console.error("WhatsApp error:", err);
    twiml.message("Sorry, I hit a snag. A team member will get back to you shortly.");
  }

  res.type("text/xml").send(twiml.toString());
});

// --- Voice: incoming call ---------------------------------------------------
app.post("/voice", (req, res) => {
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: "speech",
    action: "/voice/respond",
    method: "POST",
    speechTimeout: "auto",
    language: "en-US",
  });
  gather.say({ voice: "Polly.Joanna" }, business.voiceGreeting);
  // If the caller says nothing, repeat.
  twiml.redirect("/voice");
  res.type("text/xml").send(twiml.toString());
});

// --- Voice: caller spoke, AI replies, then listens again --------------------
app.post("/voice/respond", async (req, res) => {
  const from = req.body.From; // e.g. "+15551234567"
  const speech = (req.body.SpeechResult || "").trim();
  const id = contactId(from);
  const twiml = new VoiceResponse();

  try {
    if (!speech) {
      const gather = twiml.gather({
        input: "speech",
        action: "/voice/respond",
        method: "POST",
        speechTimeout: "auto",
        language: "en-US",
      });
      gather.say({ voice: "Polly.Joanna" }, "Sorry, I didn't catch that. Could you say it again?");
      twiml.redirect("/voice");
      return res.type("text/xml").send(twiml.toString());
    }

    const reply = await getReply({ id, channel: "voice", userText: speech });

    const gather = twiml.gather({
      input: "speech",
      action: "/voice/respond",
      method: "POST",
      speechTimeout: "auto",
      language: "en-US",
    });
    gather.say({ voice: "Polly.Joanna" }, reply);
    // If they go quiet after the reply, gently close.
    twiml.say({ voice: "Polly.Joanna" }, "Thanks for calling. Goodbye!");
    twiml.hangup();
  } catch (err) {
    console.error("Voice error:", err);
    twiml.say({ voice: "Polly.Joanna" }, "Sorry, something went wrong. Please call back shortly.");
    twiml.hangup();
  }

  res.type("text/xml").send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI assistant for ${business.name} running on port ${PORT}`);
  console.log(`  WhatsApp webhook:  POST /whatsapp`);
  console.log(`  Voice webhook:     POST /voice`);

  // Appointment reminders: check on startup, then on an interval.
  const everyMin = Number(process.env.REMINDER_INTERVAL_MIN || 15);
  const tick = () =>
    checkReminders().catch((err) => console.error("Reminder check failed:", err.message));
  tick();
  setInterval(tick, everyMin * 60 * 1000);
  console.log(`  Reminders:         every ${everyMin} min`);
});
