import crypto from "crypto";

const TELEGRAM_API = "https://api.telegram.org";

export function requireBotToken() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN is not set");
  }
  return token;
}

export async function setWebhook(url: string) {
  const token = requireBotToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`setWebhook failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function getWebhookInfo() {
  const token = requireBotToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getWebhookInfo`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`getWebhookInfo failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function deleteWebhook() {
  const token = requireBotToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/deleteWebhook`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`deleteWebhook failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function getUpdates(params: { offset?: number; limit?: number; timeout?: number } = {}) {
  const token = requireBotToken();
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.timeout !== undefined) search.set("timeout", String(params.timeout));
  const url = `${TELEGRAM_API}/bot${token}/getUpdates?${search.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`getUpdates failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function sendTelegramMessage(chatId: number, text: string) {
  const token = requireBotToken();
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${body}`);
  }
  return res.json();
}

export function generateSecretToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

