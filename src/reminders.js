// ============================================================================
// APPOINTMENT REMINDERS  -  sends a WhatsApp nudge before each appointment
// (default: when it's within 24 hours away). Runs on a timer from server.js.
//
// How it works: every booking is in data/leads.json with a start_iso. This
// scans them, and for any appointment that is now within REMINDER_HOURS_BEFORE
// and hasn't been reminded yet, it sends a WhatsApp message and marks
// reminderSent = true so it's never sent twice.
// ============================================================================

import { business } from "./config.js";
import { readLeads, writeLeads } from "./memory.js";
import { sendWhatsApp } from "./whatsapp.js";
import { friendlyTime, naiveMs, nowNaiveInTz } from "./util.js";

export async function checkReminders() {
  const tz = process.env.BUSINESS_TIMEZONE || "America/Chicago";
  const hoursBefore = Number(process.env.REMINDER_HOURS_BEFORE || 24);
  const windowMs = hoursBefore * 3600 * 1000;

  const leads = readLeads();
  const nowMs = naiveMs(nowNaiveInTz(tz));
  let changed = false;
  let sent = 0;

  for (const lead of leads) {
    if (lead.type !== "book_appointment" || lead.reminderSent || !lead.start_iso) {
      continue;
    }
    const remaining = naiveMs(lead.start_iso) - nowMs;
    // Only remind for upcoming appointments that are within the window.
    if (remaining <= 0 || remaining > windowMs) continue;

    const when = friendlyTime(lead.start_iso);
    const msg =
      `⏰ Reminder from ${business.name}\n\n` +
      `Hi ${lead.name || "there"}, this is a reminder of your appointment:\n` +
      `🗓️ ${when}\n` +
      `📋 ${lead.reason || "your visit"}\n\n` +
      `Reply here to confirm, reschedule, or cancel. See you soon!`;

    try {
      const sid = await sendWhatsApp(lead.contact, msg);
      if (!sid) {
        // WhatsApp not configured: log it but don't mark sent, so it goes out
        // for real once Twilio is wired up.
        console.log(`[reminder] would send to ${lead.contact} for ${lead.start_iso} (whatsapp not configured)`);
        continue;
      }
      lead.reminderSent = true;
      lead.reminderSentAt = new Date().toISOString();
      changed = true;
      sent++;
      console.log(`[reminder] sent to ${lead.contact} for ${lead.start_iso} (${sid})`);
    } catch (err) {
      console.error(`[reminder] failed for ${lead.contact}:`, err.message);
    }
  }

  if (changed) writeLeads(leads);
  return sent;
}
