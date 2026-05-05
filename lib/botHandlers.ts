import { bindTelegramUser, findByToken } from "@/lib/botStorage";
import { sendTelegramMessage } from "@/lib/telegram";

async function handleBindToken(chatId: number, payload: string, from: any) {
  const record = await findByToken(payload);
  if (!record) {
    await sendTelegramMessage(chatId, "Ссылка устарела или неверна. Сгенерируйте новую на сайте.");
    return;
  }

  await bindTelegramUser(payload, from || {});
  await sendTelegramMessage(
    chatId,
    `✅ Уведомления включены.\nГруппа: ${record.groupId}\nФамилия: ${record.studentName}\nТеперь я буду присылать изменения оценок и расписания.`
  );
}

async function handleStart(chatId: number, text: string, from: any) {
  const parts = text.trim().split(/\s+/);
  const payload = parts[1];
  if (!payload) {
    await sendTelegramMessage(chatId, "Нужна стартовая ссылка или токен из сайта, чтобы привязать уведомления.");
    return;
  }
  await handleBindToken(chatId, payload, from);
}

export async function handleUpdate(update: any) {
  const message = update?.message;
  const chatId = message?.chat?.id;

  if (message?.text && chatId) {
    const text: string = message.text;
    const tokenCandidate = text.trim();
    const tokenRegex = /^[A-Za-z0-9_-]{6,64}$/;

    if (text.startsWith("/start")) {
      await handleStart(chatId, text, message.from);
    } else if (tokenRegex.test(tokenCandidate)) {
      await handleBindToken(chatId, tokenCandidate, message.from);
    } else {
      await sendTelegramMessage(
        chatId,
        "Я шлю уведомления об изменениях. Чтобы привязать аккаунт, нажмите «Включить уведомления» на сайте и пришлите мне токен или старт-ссылку."
      );
    }
  }
}

