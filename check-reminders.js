// Manually run the reminder check once (useful for testing / cron jobs).
// Run:  node check-reminders.js
import "dotenv/config";
import { checkReminders } from "./src/reminders.js";

const sent = await checkReminders();
console.log(`Reminder check complete. ${sent} reminder(s) sent.`);
