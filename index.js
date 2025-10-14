import fs from "fs";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import express from "express";

dotenv.config();

const app = express();
app.use(express.json()); // ✅ required for Telegram webhook

const PORT = process.env.PORT || 3000;

// Health check route — light and log-free
app.get("/health", (req, res) => {
  const userAgent = req.headers["user-agent"] || "";
  if (userAgent.includes("cron-job.org")) {
    return res.type("text").send("OK");
  }
  res.status(403).send("Forbidden");
});

app.listen(PORT, () => {
  console.log(`✅ HTTP server running on port ${PORT}`);
});

// ⛔️ Skip full bot startup if it's just cron-job health check
const userAgent = process.env.CRON_USER_AGENT || "";
if (userAgent.includes("cron-job.org")) {
  console.log("⚠️ Skipping bot startup for cron-job health check");
  process.exit(0); // ✅ use this instead of `return;`
}

// === BOT LOGIC STARTS HERE ===

// REPLACED polling with webhook (keeps the rest of your code intact)
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
// Setup webhook path & route (requires BASE_URL in env, e.g. https://yourdomain.com)
const webhookPath = `/bot${process.env.TELEGRAM_TOKEN}`;
const webhookUrl = `${process.env.BASE_URL}${webhookPath}`;
(async () => {
  try {
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set to: ${webhookUrl}`);
  } catch (err) {
    console.error("❌ Failed to set webhook:", err.message);
  }
})();

app.post(webhookPath, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

const faqData = loadFAQ();

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
launch_date: ${faqData.launch_date}
Registration Bonus: ${faqData.registration_bonus}
Minimum Deposit: ₵75
Minimum Withdrawal: ₵25
withdrawal fee: ${faqData["withdrawal fee"]}
Plans: ${faqData.plans.map(p => `${p.name} - Daily Income: ${p.Daily_Income}, Duration: ${p.duration}, Price: ${p.price}`).join("; ")}
Withdrawals: ${faqData.withdrawals}
withdrawal Account Binding Steps: ${faqData.Bind_withdrawal_Account_steps.join(" -> ")}
change account password: ${faqData.Change_Account_Password_steps.join(" -> ")}
registration link: ${faqData.registration_link}
official domain: ${faqData.official_domain}
Referral: ${faqData.referral}
Support: ${faqData.support}

Always end your message with: "If you need more help, contact support ${ADMIN_USERNAME}".
  `;
}

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
  "deposit", "depositing", "withdraw", "withdrawal", "withdrawals", "cash out", "payout", "pay out",
  "plan", "plans", "package", "packages", "subscription", "tier", "level",
  "balance", "account balance", "funds", "wallet", "credit", "debit", "statement",
  "referral", "refer", "referrer", "bonus", "reward", "commission", "commissions",
  "team", "group", "network", "downline", "upline", "member",
  "registration", "register", "sign up", "signup", "create account", "account creation",
  "niconetwork", "nico network", "investment", "invest", "investing",
  "profit", "profits", "earn", "earning", "income", "return", "returns",
  "interest", "interest rate", "ROI", "revenue",
  "pay", "payment", "paid", "payout", "receive money", "withdraw funds",
  "VIP", "premium", "elite", "exclusive",
  "account", "user account", "profile", "login", "log in", "sign in", "credentials", "password", "security",
  "scam", "fraud", "fake", "legit", "legitimate", "trust", "trusted", "safe", "secure", "reliable", "authentic",
  "collapse", "shutdown", "closing", "closing down", "end", "finish", "run away", "exit scam",
  "launched", "launch", "start", "begin", "grow", "growth", "increase", "raise", "boost", "expand",
  "money", "cash", "funds", "capital", "currency", "finance", "finances",
  "support", "help", "customer service", "contact", "admin", "administrator", "moderator", "manager",
  "platform", "site", "website", "webpage", "app", "application", "software", "system",
  "invest", "investment", "fund", "funding", "backing",
  "explain", "explanation", "how to", "guide", "instructions", "tutorial", "steps", "process",
  "bonus", "extra", "perk", "benefit",
  "referral code", "promo code", "discount", "voucher",
  "withdrawal fee", "transaction fee", "charge", "cost",
  "account verification", "verify account", "KYC", "identity check",
  "deposit bonus", "welcome bonus", "signup bonus",
  "payment methods", "deposit options", "withdraw options",
  "affiliate", "partner", "affiliate program",
  "terms", "conditions", "policy", "rules",
  "privacy", "data protection",
  "complaint", "issue", "problem", "bug",
  "security breach", "hacked", "phishing",
  "referral link", "invite link",
  "support ticket", "customer support", "live chat",
];

  return keywords.some((kw) => text.toLowerCase().includes(kw));
}

function cleanFormatting(text) {
  return text
    .replace(/\*\*/g, "*")
    .replace(/[_]{2,}/g, "_")
    .replace(/\n{3,}/g, "\n\n");
}

bot.on("new_chat_members", async (msg) => {
  const chatId = msg.chat.id;
  for (const member of msg.new_chat_members) {
    await bot.sendMessage(chatId, GROUP_RULES, { parse_mode: "Markdown" });
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || "";
  if (!text || msg.from.is_bot) return;

  const lowerText = text.toLowerCase();

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

  if (INSULT_WORDS.some((w) => lowerText.includes(w))) {
    await bot.sendMessage(
      chatId,
      `⚠️ @${msg.from.username || msg.from.first_name}, please avoid using offensive words. Let’s keep this space respectful.`
    );
    return;
  }

  if (/^(hi|hello|hey|ok|😂|😅|😊|👍|🙌|🙏|😁|🤣|❤️|ok+|k+)$/.test(lowerText) || lowerText.length < 3) return;
  if (!isNicoNetworkRelated(text)) return;

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
    await bot.sendMessage(chatId, cleaned, {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id, // ✅ This makes it reply directly
        });
  } catch (err) {
    console.error("GPT reply failed:", err);
  }
});

console.log("🤖 NicoNetwork Bot is live — clean, polite, and informative.");
