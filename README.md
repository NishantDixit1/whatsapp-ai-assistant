# WhatsApp + AI Call Assistant

One AI assistant that answers **WhatsApp messages and phone calls** 24/7, answers
questions from a business knowledge base, and actually **books appointments and
captures leads** (saved to `data/leads.json`). WhatsApp and voice share the same
brain and the same memory per phone number, so a call can follow up by text and
the AI remembers the conversation.

## What's inside

| File | What it does |
|------|--------------|
| `src/config.js` | The business profile. **The only file you edit per client.** |
| `src/ai.js` | The Groq (Llama) brain + the two actions (book, capture lead). |
| `src/calendar.js` | Creates real Google Calendar events for bookings. |
| `src/whatsapp.js` | Sends outbound WhatsApp messages (booking confirmations). |
| `src/reminders.js` | Sends a WhatsApp reminder before each appointment. |
| `src/memory.js` | Shared conversation memory + saves leads to disk. |
| `src/util.js` | Shared time helpers (timezone-safe). |
| `server.js` | Twilio webhooks for WhatsApp and voice. |
| `test-chat.js` | Test the AI in your terminal, no phone needed. |

## 1. Install

```bash
cd ~/whatsapp-ai-assistant
npm install
cp .env.example .env   # then fill in your keys
```

## 2. Get keys

- **Groq API key (free)** -> https://console.groq.com (the AI brain).
- **Twilio account** -> https://twilio.com (WhatsApp + phone). Use the WhatsApp
  Sandbox to start free, and a Twilio phone number for calls.

Put them in `.env`.

## 3. Test the brain right now (no phone needed)

```bash
node test-chat.js
```

Chat with it. Try: *"how much is whitening?"* then *"book me in, name's Sam,
Tuesday 3pm, cleaning"*. Watch the booking appear in `data/leads.json`.
This is your **demo** for clients.

## 4. Go live with WhatsApp + calls

```bash
npm start
```

Then expose your local server so Twilio can reach it:

```bash
npx ngrok http 3000
```

In the Twilio console, set the webhooks to your ngrok URL:

- **WhatsApp** Sandbox -> "When a message comes in": `https://YOUR.ngrok.app/whatsapp` (POST)
- **Phone number** -> Voice "A call comes in": `https://YOUR.ngrok.app/voice` (POST)

Now message the WhatsApp number or call the phone number and the AI answers.

## 5. Make it a different business

Open `src/config.js` and change the name, greetings, knowledge, and prices.
That's the whole per-client setup. Everything else stays the same.

## Google Calendar (real bookings)

`book_appointment` creates a real event on a Google Calendar. Set this up once
per client (full steps are also in `src/calendar.js`):

1. In the [Google Cloud console](https://console.cloud.google.com), create a
   project and **enable the Google Calendar API**.
2. Create a **Service Account**, then create a **JSON key** for it and download it.
3. Save that file as `google-service-account.json` in this folder (it's
   gitignored). Point `GOOGLE_SERVICE_ACCOUNT_KEY` at it in `.env`.
4. Open the target calendar's **Settings -> Share with specific people** and add
   the service account's email (`...@...iam.gserviceaccount.com`) with
   **"Make changes to events"**.
5. Set `GOOGLE_CALENDAR_ID` (usually the calendar owner's email) and
   `BUSINESS_TIMEZONE` (e.g. `Asia/Seoul`, `Asia/Kolkata`, `America/Chicago`).

If these aren't set, booking still works but only records to `data/leads.json`,
so you can demo without Calendar configured.

## Booking confirmations (WhatsApp)

After every successful booking, the customer gets a WhatsApp confirmation
(`src/whatsapp.js`). This works even when the booking was made over a phone
call, so the call follows up by text automatically.

One WhatsApp rule to know for production: you can only send free-form messages
within **24 hours** of the customer's last message. For bookings taken on a
call where the customer never messaged you, WhatsApp requires a pre-approved
**message template**. The Twilio sandbox and any recently-chatting customer work
free-form; for production, register a `booking_confirmation` template and send
it via `contentSid`.

## Appointment reminders

The server automatically sends a WhatsApp reminder before each appointment.
When you run `npm start`, it checks every `REMINDER_INTERVAL_MIN` minutes (default
15) and, for any booking now within `REMINDER_HOURS_BEFORE` hours (default 24)
that hasn't been reminded yet, it sends a WhatsApp nudge and marks it done so it
never sends twice.

Test it without waiting:

```bash
node check-reminders.js   # runs one reminder check now
```

For production you can also run that on a cron instead of the in-process timer.

## Notes / next steps

- Conversation history is in-memory (resets on restart). For production, move
  the `conversations` map in `src/memory.js` to Redis or a database. Leads are
  already saved to disk.
- The phone assistant uses Twilio's built-in speech + voice (simple and works).
  For a more human, lower-latency voice, swap the `/voice` flow for **Vapi** or
  **Retell** and keep `src/ai.js` as the brain.
- `book_appointment` currently logs to `data/leads.json`. Wire it to Google
  Calendar / the client's booking system in `runTool()` in `src/ai.js`.
