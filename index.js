import fs from "fs";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import express from "express";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("💥 Yo! NicoNetwork GangBot is live and running on the streets!");
});

app.listen(PORT, () => console.log(`🌐 HTTP server running on port ${PORT}`));

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === CONFIG ===
const OFFICIAL_DOMAINS = ["niconetwork.cfd"];
const INSULT_WORDS = [
  "fool", "idiot", "stupid", "nonsense", "mad", "useless", "bastard", "sheep", "gyimi", "aboa", "kwasea", "kwasia",
  "fuck", "f***", "asshole", "shit", "moron", "dumb", "retard", "goat", "gbemi", "sormi", "damn"
];

const GROUP_RULES = `
👋 *Yo welcome to NicoNetwork Official Gang!*
Listen up fam 👇

📜 *Group Rules:*
- Keep it cool, no insults or spam.
- Only NicoNetwork links allowed (https://niconetwork.cfd).
- We open *10:00 AM* sharp, close *8:00 PM* — respect the grind hours.
- Help each other out, don’t act shady.

If you need deeper game, message support: @admin99
`;

// === LOAD PLATFORM DATA ===
const faqData = JSON.parse(fs.readFileSync("./data/faq.json", "utf-8"));

// === GPT CONTEXT (GANGSTER PERSONALITY) ===
function generateContext() {
  return `
You are "Nico", the official *NicoNetwork GangBot* — a smart, street-savvy assistant who talks with a confident, funny, slightly gangster vibe (but always respectful).

You ONLY answer questions about NicoNetwork (deposits, withdrawals, referrals, plans, bonuses, etc.).
Ignore unrelated convos. If it’s not about NicoNetwork, stay quiet like a real OG.

Tone example:
- Keep it chill, short, confident, and friendly.
- Use casual slang like “fam”, “boss”, “yo”, “listen”, “no cap”, “for real”, “gang”.
- Never be rude or offensive.
- When explaining, sound like you know the hustle but keep it professional.

Example answers:
User: "How do I deposit?"
Bot: "Yo fam 💰, to drop your funds, just log in and hit that *Deposit* button. Pick your plan, confirm it, and boom 💸 — your investment starts cookin'. If you need help, hit up the boss @admin99."

User: "What’s referral bonus?"
Bot: "Gang, every time someone joins through your link, you bag that bonus 💵. NicoNetwork rewards the real ones out here. Respect the hustle."

Here’s the official NicoNetwork data:
About: ${faqData.about}
Plans: ${faqData.plans.map(p => `${p.name} - Daily Income: ${p.Daily_Income}, Duration: ${p.duration}, Min Deposit: ${p.min_deposit}`).join("; ")}
Withdrawals: ${faqData.withdrawals}
Referral: ${faqData.referral}
Support: ${faqData.support}

Always end your helpful messages with: "If you need clearer explanation contact the boss @admin99".
  `;
}

// === UTILITIES ===
let botAdminCache = {};

async function botCanDeleteMessages(chatId) {
  const cached = botAdminCache[chatId];
  const now = Date.now();
  if (cached && cached.expires > now) return cached.canDelete;

  try {
    const admins = await bot.getChatAdministrators(chatId);
    const me = await bot.getMe();
    const self = admins.find((a) => a.user.is_bot && a.user.username === me.username);
    const canDelete = !!self && (self.can_delete_messages === true || self.status === "creator");
    botAdminCache[chatId] = { canDelete, expires: now + 5 * 60 * 1000 };
    return canDelete;
  } catch (err) {
    console.error("Admin check failed:", err.message);
    return false;
  }
}

function extractLinksFromMessage(msg) {
  const urls = new Set();
  const entities = [].concat(msg.entities || [], msg.caption_entities || [], msg.message_entities || []);

  for (const e of entities) {
    if (e.type === "url" && msg.text) {
      const link = msg.text.substring(e.offset, e.offset + e.length);
      urls.add(link);
    } else if (e.type === "text_link" && e.url) {
      urls.add(e.url);
    }
  }

  const textToScan = (msg.text || "") + " " + (msg.caption || "");
  const regex = /(https?:\/\/[^\s]+)/gi;
  let m;
  while ((m = regex.exec(textToScan)) !== null) urls.add(m[0]);
  return Array.from(urls);
}

function isOfficialUrl(link) {
  try {
    const normalized = link.startsWith("http") ? link : `https://${link}`;
    const hostname = new URL(normalized).hostname.replace(/^www\./, "").toLowerCase();
    return OFFICIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function isNicoNetworkRelated(text) {
  const keywords = [
    "deposit", "withdraw", "plan", "balance", "referral", "earn", "bonus", "register",
    "niconetwork", "investment", "profit", "return", "interest", "account", "login"
  ];
  return keywords.some((kw) => text.toLowerCase().includes(kw));
}

function cleanFormatting(text) {
  return text
    .replace(/\*\*/g, "*")
    .replace(/[_]{2,}/g, "_")
    .replace(/\n{3,}/g, "\n\n");
}

// === EVENT: NEW MEMBER ===
bot.on("new_chat_members", async (msg) => {
  const chatId = msg.chat.id;
  for (const member of msg.new_chat_members) {
    await bot.sendMessage(chatId, GROUP_RULES, { parse_mode: "Markdown" });
  }
});

// === MAIN HANDLER ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || "";
  if (!text || msg.from.is_bot) return;

  const lowerText = text.toLowerCase();

  // 1️⃣ Delete non-official links silently
  const links = extractLinksFromMessage(msg);
  if (links.length > 0 && !links.every(isOfficialUrl)) {
    const canDelete = await botCanDeleteMessages(chatId);
    if (canDelete) {
      try {
        await bot.deleteMessage(chatId, msg.message_id);
        return;
      } catch (err) {
        console.error("Delete message failed:", err.message);
      }
    }
  }

  // 2️⃣ Detect insults
  if (INSULT_WORDS.some((w) => lowerText.includes(w))) {
    await bot.sendMessage(
      chatId,
      `⚠️ Yo @${msg.from.username || msg.from.first_name}, chill fam. Watch your mouth — we keep it cool in the gang.`
    );
    return;
  }

  // 3️⃣ Ignore short or random chats
  if (/^(hi|hello|hey|ok|😂|😅|😊|👍|🙌|🙏|😁|🤣|❤️|ok+|k+)$/.test(lowerText) || lowerText.length < 3) return;

  // 4️⃣ Only reply to NicoNetwork-related stuff
  if (!isNicoNetworkRelated(text)) return;

  // 5️⃣ Generate gangster-style GPT reply
  try {
    await bot.sendChatAction(chatId, "typing");
    const context = generateContext();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      messages: [
        { role: "system", content: context },
        { role: "user", content: text },
      ],
    });

    const reply = completion.choices[0].message.content || "";
    const cleaned = cleanFormatting(reply);
    await bot.sendMessage(chatId, cleaned, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("GPT reply failed:", err);
  }
});

console.log("🤖 NicoNetwork GangBot is live — keeping the chat clean and talking slick 😎");
