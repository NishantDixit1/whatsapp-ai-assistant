// Quick local test of the AI brain WITHOUT Twilio.
// Run:  node test-chat.js
// Type messages, see the AI reply and watch it book/capture into data/leads.json.

import "dotenv/config";
import readline from "node:readline";
import { getReply } from "./src/ai.js";
import { business } from "./src/config.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const id = "test-user";

console.log(`\n${business.assistantName} (${business.name}) - local test. Type 'exit' to quit.\n`);
console.log(`${business.assistantName}: ${business.whatsappGreeting}\n`);

function ask() {
  rl.question("You: ", async (line) => {
    if (line.trim().toLowerCase() === "exit") return rl.close();
    try {
      const reply = await getReply({ id, channel: "whatsapp", userText: line });
      console.log(`\n${business.assistantName}: ${reply}\n`);
    } catch (err) {
      console.error("Error:", err.message);
    }
    ask();
  });
}
ask();
