import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "./platform";
import { NativeNotification } from "./notificationPlugin";

let channelsCreated = false;

async function ensureChannels() {
  if (!isNativeApp() || channelsCreated) return;

  try {
    // Канал для журнала (высокий приоритет)
    await LocalNotifications.createChannel({
      id: "journal",
      name: "Журнал",
      description: "Уведомления о новых оценках",
      importance: 4,
      vibration: true,
      lights: true,
    });

    // Канал для расписания (высокий приоритет)
    await LocalNotifications.createChannel({
      id: "timetable",
      name: "Расписание",
      description: "Уведомления об изменениях в расписании",
      importance: 4,
      vibration: true,
      lights: true,
    });

    // Канал для тестовых уведомлений
    await LocalNotifications.createChannel({
      id: "test",
      name: "Тест",
      description: "Тестовые уведомления",
      importance: 4,
      vibration: true,
      lights: true,
    });

    channelsCreated = true;
    console.log("[Notifications] Channels created");
  } catch (err) {
    console.error("[Notifications] Failed to create channels:", err);
  }
}

async function scheduleBackgroundNotificationNative(
  title: string,
  body: string,
  delaySeconds: number
) {
  try {
    console.log("[scheduleBackgroundNotificationNative] Calling Capacitor NotificationPlugin", {
      title,
      delaySeconds,
    });
    await NativeNotification.scheduleBackgroundNotification({
      title,
      body,
      delaySeconds,
    });
    console.log("[Native] Background notification scheduled:", title);
  } catch (err) {
    console.error("[Native] Failed to schedule background notification:", err);
    throw err;
  }
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  id: number = Date.now(),
  type: "journal" | "timetable" | "test" = "test",
  useWorkManager: boolean = false,
  delaySeconds: number = 0
) {
  if (!isNativeApp()) return;

  if (useWorkManager && Capacitor.getPlatform() === "android") {
    await scheduleBackgroundNotificationNative(title, body, delaySeconds);
    return;
  }

  try {
    await ensureChannels();

    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          channelId: type,
          smallIcon: "ic_stat_minikbp",
          largeIcon: "ic_launcher",
          autoCancel: true,
        },
      ],
    });
    console.log("[Notifications] Scheduled:", title, "type:", type);
  } catch (err) {
    console.error("[Notifications] Failed to schedule:", err);
  }
}

// Экспорт функции для планирования фонового уведомления
export async function scheduleBackgroundNotification(
  title: string,
  body: string,
  delaySeconds: number = 5
) {
  return scheduleLocalNotification(title, body, Date.now(), "test", true, delaySeconds);
}

// Запуск периодической фоновой синхронизации
export async function startBackgroundSync(intervalMinutes: number = 60) {
  if (!isNativeApp() || Capacitor.getPlatform() !== "android") {
    console.log("[BackgroundSync] Not on Android, skipping");
    return;
  }

  try {
    console.log("[BackgroundSync] Starting periodic sync (native interval fixed in WorkManager)", intervalMinutes);
    await NativeNotification.startPeriodicSync();
    console.log("[BackgroundSync] Started successfully");
  } catch (err) {
    console.error("[BackgroundSync] Failed to start:", err);
  }
}

// Остановка периодической фоновой синхронизации
export async function stopBackgroundSync() {
  if (!isNativeApp() || Capacitor.getPlatform() !== "android") {
    return;
  }

  try {
    await NativeNotification.stopPeriodicSync();
    console.log("[BackgroundSync] Stopped");
  } catch (err) {
    console.error("[BackgroundSync] Failed to stop:", err);
  }
}

// Немедленная ручная синхронизация
export async function triggerImmediateSync() {
  if (!isNativeApp() || Capacitor.getPlatform() !== "android") {
    return;
  }

  try {
    await NativeNotification.syncNow();
    console.log("[BackgroundSync] Immediate sync triggered");
  } catch (err) {
    console.error("[BackgroundSync] Failed to trigger immediate sync:", err);
  }
}

export async function scheduleQuickSyncOnClose(delaySeconds: number = 15) {
  if (!isNativeApp() || Capacitor.getPlatform() !== "android") return;
  try {
    await NativeNotification.scheduleQuickSync({ delaySeconds });
    console.log("[BackgroundSync] Quick close-sync scheduled", delaySeconds);
  } catch (err) {
    console.error("[BackgroundSync] Failed to schedule close-sync:", err);
  }
}

export async function requestNotificationPermissions() {
  if (!isNativeApp()) return false;

  try {
    const result = await LocalNotifications.requestPermissions();
    return result.display === "granted";
  } catch (err) {
    console.error("[Notifications] Permission request failed:", err);
    return false;
  }
}

export async function checkNotificationPermissions() {
  if (!isNativeApp()) return false;

  try {
    const result = await LocalNotifications.checkPermissions();
    return result.display === "granted";
  } catch (err) {
    console.error("[Notifications] Permission check failed:", err);
    return false;
  }
}
