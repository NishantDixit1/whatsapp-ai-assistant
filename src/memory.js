// ============================================================================
// SHARED MEMORY  -  one conversation history per contact (phone number),
// shared across BOTH WhatsApp and phone calls. So a call can follow up by text
// and the AI remembers what was said. Leads/bookings are saved to disk.
//
// NOTE: conversation history is in-memory (resets on restart). For production,
// move `conversations` to Redis or a database. Leads ARE persisted to disk.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");

// contactId (the bare phone number) -> array of {role, content} messages
const conversations = new Map();

// Normalize "whatsapp:+1555..." and "+1555..." to the same key.
export function contactId(rawFrom) {
  return String(rawFrom).replace(/^whatsapp:/, "").trim();
}

export function getHistory(id) {
  return conversations.get(id) || [];
}

export function setHistory(id, messages) {
  // Keep the last 30 turns so context stays small and cheap.
  let trimmed = messages.slice(-30);
  // A "tool" message must follow the assistant message that requested it.
  // After trimming, drop any leading orphaned tool messages.
  while (trimmed.length && trimmed[0].role === "tool") {
    trimmed = trimmed.slice(1);
  }
  conversations.set(id, trimmed);
}

// Read all saved leads/bookings from data/leads.json.
export function readLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
  } catch {
    return [];
  }
}

// Overwrite the whole leads file (used to update flags like reminderSent).
export function writeLeads(leads) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// Append a saved lead/booking to data/leads.json.
export function saveLead(lead) {
  const leads = readLeads();
  leads.push(lead);
  writeLeads(leads);
  return lead;
}

// Index of the most recent non-cancelled booking for a contact, or -1.
function latestActiveIndex(leads, contact) {
  for (let i = leads.length - 1; i >= 0; i--) {
    const l = leads[i];
    if (
      l.type === "book_appointment" &&
      l.contact === contact &&
      l.status !== "cancelled"
    ) {
      return i;
    }
  }
  return -1;
}

// The customer's current active booking, or null.
export function getActiveBooking(contact) {
  const leads = readLeads();
  const i = latestActiveIndex(leads, contact);
  return i >= 0 ? leads[i] : null;
}

// Apply `changes` to the customer's active booking. Returns the updated
// record, or null if they have no active booking.
export function updateActiveBooking(contact, changes) {
  const leads = readLeads();
  const i = latestActiveIndex(leads, contact);
  if (i < 0) return null;
  leads[i] = { ...leads[i], ...changes };
  writeLeads(leads);
  return leads[i];
}
