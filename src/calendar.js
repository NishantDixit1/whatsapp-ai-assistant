// ============================================================================
// GOOGLE CALENDAR  -  creates a real appointment event using a service account.
//
// SETUP (once per client calendar):
//   1. In Google Cloud console, create a project and enable the
//      "Google Calendar API".
//   2. Create a Service Account, then create a JSON key for it. Download it.
//   3. Save that file (e.g. ./google-service-account.json) and point
//      GOOGLE_SERVICE_ACCOUNT_KEY at it in .env.
//   4. Open the target Google Calendar's settings -> "Share with specific
//      people" -> add the service account's email (xxx@xxx.iam.gserviceaccount.com)
//      with "Make changes to events" permission.
//   5. Set GOOGLE_CALENDAR_ID in .env to that calendar's ID (often the
//      calendar owner's email address, or find it in calendar settings).
//   6. Set BUSINESS_TIMEZONE to an IANA zone, e.g. "America/Chicago".
//
// If these aren't set, booking still works but only saves to data/leads.json.
// ============================================================================

import { google } from "googleapis";
import { toNaive, addMinutes } from "./util.js";

let cachedClient = null;

export function calendarConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GOOGLE_CALENDAR_ID
  );
}

function getClient() {
  if (cachedClient) return cachedClient;
  if (!calendarConfigured()) return null;
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  cachedClient = google.calendar({ version: "v3", auth });
  return cachedClient;
}

// Returns { id, htmlLink } on success, or null if Calendar isn't configured.
// Throws on a real API error so the caller can fall back gracefully.
export async function createEvent({
  name,
  startIso,
  durationMinutes = 30,
  reason,
  notes,
  contact,
}) {
  const cal = getClient();
  if (!cal) return null;

  const tz = process.env.BUSINESS_TIMEZONE || "America/Chicago";
  const start = toNaive(startIso);
  const end = addMinutes(start, durationMinutes);

  const description = [
    reason && `Reason: ${reason}`,
    contact && `Contact: ${contact}`,
    notes && `Notes: ${notes}`,
    "Booked automatically by the AI assistant.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await cal.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: {
      summary: `${name || "Appointment"}${reason ? " - " + reason : ""}`,
      description,
      start: { dateTime: start, timeZone: tz },
      end: { dateTime: end, timeZone: tz },
    },
  });

  return { id: res.data.id, htmlLink: res.data.htmlLink };
}

// Move/update an existing event to a new time (used when rescheduling).
// Returns { id, htmlLink } or null if Calendar isn't configured / no eventId.
export async function updateEvent(eventId, { name, startIso, durationMinutes = 30, reason }) {
  const cal = getClient();
  if (!cal || !eventId) return null;

  const tz = process.env.BUSINESS_TIMEZONE || "America/Chicago";
  const start = toNaive(startIso);
  const end = addMinutes(start, durationMinutes);

  const res = await cal.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId,
    requestBody: {
      summary: `${name || "Appointment"}${reason ? " - " + reason : ""}`,
      start: { dateTime: start, timeZone: tz },
      end: { dateTime: end, timeZone: tz },
    },
  });

  return { id: res.data.id, htmlLink: res.data.htmlLink };
}

// Delete an event (used when cancelling). Returns true if deleted.
export async function deleteEvent(eventId) {
  const cal = getClient();
  if (!cal || !eventId) return false;
  await cal.events.delete({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId,
  });
  return true;
}
