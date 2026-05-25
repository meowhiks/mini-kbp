package com.kbp.journal;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class NotificationWorker extends Worker {
    private static final String TAG = "NotificationWorker";
    public static final String CHANNEL_ID_JOURNAL = "journal_updates";
    public static final String CHANNEL_ID_TIMETABLE = "timetable_updates";
    public static final String CHANNEL_ID_GENERAL = "general_notifications";

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @Override
    @NonNull
    public Result doWork() {
        Log.d(TAG, "Running background notification task");

        try {
            String title = getInputData().getString("title");
            String body = getInputData().getString("body");
            String channelId = getInputData().getString("channelId");
            int notificationId = getInputData().getInt("notificationId", (int) System.currentTimeMillis());

            if (title == null) title = "Уведомление";
            if (body == null) body = "Новое уведомление";

            createNotificationChannels();
            showNotification(title, body, channelId, notificationId);

            Log.d(TAG, "Notification shown: " + title + " [channel: " + channelId + "]");
            return Result.success();
        } catch (Exception e) {
            Log.e(TAG, "Error showing notification", e);
            return Result.failure();
        }
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Context context = getApplicationContext();
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

            // Канал для журнала (высокий приоритет)
            if (manager.getNotificationChannel(CHANNEL_ID_JOURNAL) == null) {
                NotificationChannel journalChannel = new NotificationChannel(
                    CHANNEL_ID_JOURNAL,
                    "Обновления журнала",
                    NotificationManager.IMPORTANCE_HIGH
                );
                journalChannel.setDescription("Уведомления об изменениях в журнале");
                journalChannel.enableVibration(true);
                journalChannel.enableLights(true);
                journalChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(journalChannel);
            }

            // Канал для расписания (высокий приоритет)
            if (manager.getNotificationChannel(CHANNEL_ID_TIMETABLE) == null) {
                NotificationChannel timetableChannel = new NotificationChannel(
                    CHANNEL_ID_TIMETABLE,
                    "Обновления расписания",
                    NotificationManager.IMPORTANCE_HIGH
                );
                timetableChannel.setDescription("Уведомления об изменениях в расписании");
                timetableChannel.enableVibration(true);
                timetableChannel.enableLights(true);
                timetableChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(timetableChannel);
            }

            // Общий канал (средний приоритет)
            if (manager.getNotificationChannel(CHANNEL_ID_GENERAL) == null) {
                NotificationChannel generalChannel = new NotificationChannel(
                    CHANNEL_ID_GENERAL,
                    "Общие уведомления",
                    NotificationManager.IMPORTANCE_DEFAULT
                );
                generalChannel.setDescription("Общие уведомления приложения");
                generalChannel.enableVibration(false);
                generalChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(generalChannel);
            }

            Log.d(TAG, "Notification channels created/verified");
        }
    }

    private void showNotification(String title, String body, String channelId, int notificationId) {
        Context context = getApplicationContext();

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        intent.putExtra("from_notification", true);

        // Совместимость PendingIntent для разных версий Android
        int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingIntentFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, pendingIntentFlags);

        // Определяем приоритет в зависимости от канала
        int priority = NotificationCompat.PRIORITY_DEFAULT;
        if (channelId.equals(CHANNEL_ID_JOURNAL) || channelId.equals(CHANNEL_ID_TIMETABLE)) {
            priority = NotificationCompat.PRIORITY_HIGH;
        }

        // Загружаем иконку
        Bitmap largeIcon = null;
        try {
            largeIcon = BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher);
        } catch (Exception e) {
            Log.w(TAG, "Failed to load large icon", e);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(priority)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }

        // Для Android 8.0+ добавляем category
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (channelId.equals(CHANNEL_ID_JOURNAL)) {
                builder.setCategory(NotificationCompat.CATEGORY_REMINDER);
            } else if (channelId.equals(CHANNEL_ID_TIMETABLE)) {
                builder.setCategory(NotificationCompat.CATEGORY_EVENT);
            }
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        // Проверка на наличие разрешения для Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "POST_NOTIFICATIONS permission not granted, notification may not show");
            }
        }

        manager.notify(notificationId, builder.build());
    }
}
