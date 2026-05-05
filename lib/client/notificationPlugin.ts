import { registerPlugin } from "@capacitor/core";

/** Нативный Android-плагин (WorkManager + синхронизация). На web не реализован. */
export interface NativeNotificationPlugin {
  scheduleBackgroundNotification(options: {
    title: string;
    body: string;
    channel?: string;
    delaySeconds?: number;
  }): Promise<void>;
  cancelAllNotifications(): Promise<void>;
  startPeriodicSync(): Promise<void>;
  stopPeriodicSync(): Promise<void>;
  syncNow(): Promise<void>;
  scheduleQuickSync(options?: { delaySeconds?: number }): Promise<void>;
  checkPermission(): Promise<{ granted: boolean; required: boolean }>;
  requestPermission(): Promise<void>;
  openSettings(options: { type?: "app" | "notification" }): Promise<void>;
  isSyncRunning(): Promise<{ running: boolean }>;
}

export const NativeNotification = registerPlugin<NativeNotificationPlugin>("NotificationPlugin", {
  web: undefined,
});
