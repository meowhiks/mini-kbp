package com.kbp.journal;

import android.content.Context;
import android.util.Log;

import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.WorkInfo;
import androidx.work.ExistingPeriodicWorkPolicy;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

public class NotificationScheduler {
    private static final String TAG = "NotificationScheduler";
    public static final String WORK_NAME_SYNC = "background_sync_work";

    /**
     * Планирует разовое уведомление
     */
    public static void scheduleNotification(Context context, String title, String body, int delaySeconds) {
        scheduleNotification(context, title, body, NotificationWorker.CHANNEL_ID_GENERAL, delaySeconds);
    }

    /**
     * Планирует разовое уведомление с указанием канала
     */
    public static void scheduleNotification(Context context, String title, String body, String channelId, int delaySeconds) {
        Log.d(TAG, "Scheduling notification: " + title + " to channel " + channelId + " in " + delaySeconds + "s");

        Data inputData = new Data.Builder()
            .putString("title", title)
            .putString("body", body)
            .putString("channelId", channelId)
            .putInt("notificationId", (int) System.currentTimeMillis())
            .build();

        OneTimeWorkRequest workRequest = new OneTimeWorkRequest.Builder(NotificationWorker.class)
            .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
            .setInputData(inputData)
            .build();

        WorkManager.getInstance(context).enqueue(workRequest);
        Log.d(TAG, "Notification scheduled successfully");
    }

    /**
     * Мгновенное уведомление
     */
    public static void scheduleImmediateNotification(Context context, String title, String body) {
        scheduleImmediateNotification(context, title, body, NotificationWorker.CHANNEL_ID_GENERAL);
    }

    /**
     * Мгновенное уведомление с каналом
     */
    public static void scheduleImmediateNotification(Context context, String title, String body, String channelId) {
        scheduleNotification(context, title, body, channelId, 0);
    }

    /**
     * Планирует периодическую фоновую синхронизацию
     */
    public static void schedulePeriodicSync(Context context) {
        Log.d(TAG, "Scheduling periodic background sync (every 30 minutes)");

        Data inputData = new Data.Builder().build();

        // Минимальный интервал для PeriodicWorkRequest - 15 минут
        // Устанавливаем 30 минут как запрошено
        PeriodicWorkRequest syncWork = new PeriodicWorkRequest.Builder(
                BackgroundSyncWorker.class,
                30, TimeUnit.MINUTES
            )
            .setInputData(inputData)
            .addTag(WORK_NAME_SYNC)
            .build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME_SYNC,
            ExistingPeriodicWorkPolicy.KEEP,
            syncWork
        );

        Log.d(TAG, "Periodic sync scheduled successfully");
    }

    /**
     * Отменяет всю работу
     */
    public static void cancelAllNotifications(Context context) {
        WorkManager.getInstance(context).cancelAllWork();
        Log.d(TAG, "All notifications cancelled");
    }

    /**
     * Отменяет только периодическую синхронизацию
     */
    public static void cancelPeriodicSync(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME_SYNC);
        Log.d(TAG, "Periodic sync cancelled");
    }

    /**
     * Проверяет, запущена ли периодическая синхронизация
     */
    public static boolean isPeriodicSyncRunning(Context context) {
        try {
            WorkManager workManager = WorkManager.getInstance(context);
            List<WorkInfo> workInfos = workManager.getWorkInfosForUniqueWork(WORK_NAME_SYNC).get();

            if (workInfos != null && !workInfos.isEmpty()) {
                for (WorkInfo info : workInfos) {
                    if (info.getState() == WorkInfo.State.ENQUEUED ||
                        info.getState() == WorkInfo.State.RUNNING) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error checking sync status", e);
        }
        return false;
    }
}
