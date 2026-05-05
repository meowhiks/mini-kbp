import { getBoundUsers } from "@/lib/botStorage";

const schedule: Record<number, Record<number, { start: string; end: string }>> = {
  0: { // Пн
    1: { start: "8.00", end: "8.45" }, 2: { start: "8.55", end: "9.40" }, 3: { start: "9.50", end: "10.35" },
    4: { start: "10.45", end: "11.30" }, 5: { start: "12.00", end: "12.45" }, 6: { start: "12.55", end: "13.40" },
    7: { start: "14.00", end: "14.45" }, 8: { start: "14.55", end: "15.40" }, 9: { start: "16.00", end: "16.45" },
    10: { start: "16.55", end: "17.40" }, 11: { start: "17.50", end: "18.35" }, 12: { start: "18.45", end: "19.30" },
    13: { start: "19.40", end: "20.25" }
  },
  1: { // Вт
    1: { start: "8.00", end: "8.45" }, 2: { start: "8.55", end: "9.40" }, 3: { start: "9.50", end: "10.35" },
    4: { start: "10.45", end: "11.30" }, 5: { start: "12.00", end: "12.45" }, 6: { start: "12.55", end: "13.40" },
    7: { start: "14.00", end: "14.45" }, 8: { start: "14.55", end: "15.40" }, 9: { start: "16.00", end: "16.45" },
    10: { start: "16.55", end: "17.40" }, 11: { start: "17.50", end: "18.35" }, 12: { start: "18.45", end: "19.30" },
    13: { start: "19.40", end: "20.25" }
  },
  2: { // Ср
    1: { start: "8.00", end: "8.45" }, 2: { start: "8.55", end: "9.40" }, 3: { start: "9.50", end: "10.35" },
    4: { start: "10.45", end: "11.30" }, 5: { start: "12.00", end: "12.45" }, 6: { start: "12.55", end: "13.40" },
    7: { start: "14.00", end: "14.45" }, 8: { start: "14.55", end: "15.40" }, 9: { start: "16.00", end: "16.45" },
    10: { start: "16.55", end: "17.40" }, 11: { start: "17.50", end: "18.35" }, 12: { start: "18.45", end: "19.30" },
    13: { start: "19.40", end: "20.25" }
  },
  3: { // Чт
    1: { start: "8.00", end: "8.45" }, 2: { start: "8.55", end: "9.40" }, 3: { start: "9.50", end: "10.35" },
    4: { start: "10.45", end: "11.30" }, 5: { start: "12.00", end: "12.45" }, 6: { start: "12.55", end: "13.40" },
    7: { start: "14.40", end: "15.25" }, 8: { start: "15.35", end: "16.20" }, 9: { start: "16.30", end: "17.15" },
    10: { start: "17.25", end: "18.10" }, 11: { start: "18.20", end: "19.05" }, 12: { start: "19.15", end: "20.00" },
    13: { start: "20.10", end: "20.55" }
  },
  4: { // Пт
    1: { start: "8.00", end: "8.45" }, 2: { start: "8.55", end: "9.40" }, 3: { start: "9.50", end: "10.35" },
    4: { start: "10.45", end: "11.30" }, 5: { start: "12.00", end: "12.45" }, 6: { start: "12.55", end: "13.40" },
    7: { start: "14.00", end: "14.45" }, 8: { start: "14.55", end: "15.40" }, 9: { start: "16.00", end: "16.45" },
    10: { start: "16.55", end: "17.40" }, 11: { start: "17.50", end: "18.35" }, 12: { start: "18.45", end: "19.30" },
    13: { start: "19.40", end: "20.25" }
  },
  5: { // Сб
    1: { start: "8.00", end: "8.45" }, 2: { start: "8.55", end: "9.40" }, 3: { start: "9.50", end: "10.35" },
    4: { start: "10.45", end: "11.30" }, 5: { start: "11.40", end: "12.25" }, 6: { start: "12.35", end: "13.20" },
    7: { start: "13.40", end: "14.25" }, 8: { start: "14.35", end: "15.20" }, 9: { start: "15.30", end: "16.15" },
    10: { start: "16.25", end: "17.10" }, 11: { start: "17.20", end: "18.05" }, 12: { start: "18.15", end: "19.00" },
    13: { start: "19.10", end: "19.55" }
  },
};

function toMinutes(timeStr: string) {
  const [h, m] = timeStr.split(".").map(Number);
  return h * 60 + m;
}

const triggeredSlots = new Set<string>();
let started = false;

async function triggerPoll(baseUrl: string) {
  try {
    // Сначала подтянуть апдейты (start/token), затем диффы
    await fetch(`${baseUrl}/api/bot/poll-updates`, { cache: "no-store" });
    await fetch(`${baseUrl}/api/bot/poll`, { cache: "no-store" });
  } catch (e) {
    console.error("autoPoller trigger error:", e);
  }
}

async function checkAndRun(baseUrl: string) {
  const users = await getBoundUsers();
  if (!users || users.length === 0) return;

  const now = new Date();
  const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=Пн,5=Сб,6=Вс
  if (dayIndex < 0 || dayIndex > 5) return; // игнор Вс

  const daySchedule = schedule[dayIndex];
  if (!daySchedule) return;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const windowMinutes = 10;

  for (const [pairStr, times] of Object.entries(daySchedule)) {
    const pair = Number(pairStr);
    const endMinutes = toMinutes(times.end);
    if (minutesNow >= endMinutes && minutesNow <= endMinutes + windowMinutes) {
      const slotId = `${now.toDateString()}-${dayIndex}-${pair}`;
      if (triggeredSlots.has(slotId)) continue;
      triggeredSlots.add(slotId);
      await triggerPoll(baseUrl);
    }
  }
}

export function startAutoPoller() {
  if (started) return;
  started = true;

  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  // Проверяем раз в минуту
  setInterval(() => {
    checkAndRun(baseUrl);
  }, 60_000);
  console.log("[bot] auto-poller started (after-lesson windows)");
}

