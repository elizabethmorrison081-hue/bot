import fs from "fs";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import express from "express";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🌐 NicoNetwork Bot is up and running smoothly!");
});

app.listen(PORT, () => console.log(`✅ HTTP server running on port ${PORT}`));

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === CONFIG ===
const OFFICIAL_DOMAINS = ["niconetwork.cfd"];
const ADMIN_USERNAME = "@NicoNetworkSupport";

const INSULT_WORDS = [
  "fool", "idiot", "stupid", "nonsense", "mad", "useless", "bastard",
  "sheep", "gyimi", "aboa", "kwasea", "kwasia", "fuck", "f***", "asshole",
  "shit", "moron", "dumb", "retard", "goat", "gbemi", "sormi", "damn"
];

const GROUP_RULES = `
👋 *Welcome to NicoNetwork Official Group!*

📜 *Group Rules:*
- Please stay respectful, no insults or spam.
- Only NicoNetwork links are allowed (https://niconetwork.cfd).
- Group opens *10:00 AM* and closes *8:00 PM* daily.
- Help one another and stay positive.

For assistance, message support: ${ADMIN_USERNAME}
*Enjoy your time here and happy investing!* 🚀
`;

function loadFAQ() {
  return JSON.parse(fs.readFileSync("./data/faq.json", "utf-8"));
}


// === LOAD PLATFORM DATA ===
const faqData = loadFAQ();


// === GPT CONTEXT (PROFESSIONAL PERSONALITY) ===
function generateContext() {
  return `
You are "Nico", the official *NicoNetwork Assistant Bot* — a smart, polite, and confident assistant who provides helpful, professional answers about the NicoNetwork platform.

You ONLY respond to questions related to NicoNetwork (deposits, withdrawals, referrals, plans, bonuses, account info, etc.).
Ignore unrelated conversations.

Tone:
- Professional but friendly.
- Simple, clear, and reassuring.
- Avoid slang or gangster tone completely.
- Always represent NicoNetwork positively.

Special handling:
If a user asks:
- "Is NicoNetwork a scam?" → Reply that NicoNetwork is a legitimate and trusted investment platform that is fully dedicated to providing long-term, reliable service.
- "How long will NicoNetwork last?" or "Will it collapse?" → Reply that NicoNetwork has been built for stability and long-term operation with transparent systems and ongoing improvements.
- "How can I contact admin/support?" or "Who is the admin?" → Reply that users can contact the official support team directly on Telegram via ${ADMIN_USERNAME}.

Examples:
User: "Is it a scam?"
Bot: "NicoNetwork is not a scam. It’s a genuine, secure, and transparent investment platform built to serve members responsibly for the long term."

Include this official NicoNetwork info when helpful:
About: ${faqData.about}
Plans: ${faqData.plans.map(p => `${p.name} - Daily Income: ${p.Daily_Income}, Duration: ${p.duration}, Min Deposit: ${p.min_deposit}`).join("; ")}
Withdrawals: ${faqData.withdrawals}
Referral: ${faqData.referral}
Support: ${faqData.support}

Always end your message with: "If you need more help, contact support ${ADMIN_USERNAME}".
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
    "deposit", "withdraw", "plan", "balance", "referral", "earn", "bonus",
    "register", "niconetwork", "investment", "profit", "return", "interest",
    "account", "login", "scam", "collapse", "last", "safe",
    "support", "admin", "contact", "help"
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
      `⚠️ @${msg.from.username || msg.from.first_name}, please avoid using offensive words. Let’s keep this space respectful.`
    );
    return;
  }

  // 3️⃣ Ignore short or random chats
  if (/^(hi|hello|hey|ok|😂|😅|😊|👍|🙌|🙏|😁|🤣|❤️|ok+|k+)$/.test(lowerText) || lowerText.length < 3) return;

  // 4️⃣ Only reply to NicoNetwork-related stuff
  if (!isNicoNetworkRelated(text)) return;

  // 5️⃣ Generate polite GPT reply
  try {
    await bot.sendChatAction(chatId, "typing");
    const context = generateContext();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
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

console.log("🤖 NicoNetwork Bot is live — clean, polite, and informative.");
