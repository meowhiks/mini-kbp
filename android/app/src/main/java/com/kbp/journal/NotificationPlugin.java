package com.kbp.journal;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "NotificationPlugin",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = {Manifest.permission.POST_NOTIFICATIONS}
        )
    }
)
public class NotificationPlugin extends Plugin {
    private static final String TAG = "NotificationPlugin";
    private static final int NOTIFICATION_PERMISSION_CODE = 1001;

    @PluginMethod
    public void scheduleBackgroundNotification(com.getcapacitor.PluginCall call) {
        String title = call.getString("title", "Уведомление");
        String body = call.getString("body", "Новое уведомление");
        String channel = call.getString("channel", NotificationWorker.CHANNEL_ID_GENERAL);
        int delaySeconds = call.getInt("delaySeconds", 0);

        Log.d(TAG, "Scheduling background notification: " + title + " [channel: " + channel + "]");

        NotificationScheduler.scheduleNotification(getContext(), title, body, channel, delaySeconds);
        call.resolve();
    }

    @PluginMethod
    public void cancelAllNotifications(com.getcapacitor.PluginCall call) {
        Log.d(TAG, "Cancelling all notifications");
        NotificationScheduler.cancelAllNotifications(getContext());
        call.resolve();
    }

    @PluginMethod
    public void startPeriodicSync(com.getcapacitor.PluginCall call) {
        Log.d(TAG, "Starting periodic sync (15 minutes interval)");

        try {
            NotificationScheduler.schedulePeriodicSync(getContext());
            Log.d(TAG, "Periodic sync started successfully");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start periodic sync", e);
            call.reject("Failed to start periodic sync: " + e.getMessage());
        }
    }

    @PluginMethod
    public void scheduleQuickSync(com.getcapacitor.PluginCall call) {
        int delaySeconds = call.getInt("delaySeconds", 15);
        Log.d(TAG, "Scheduling quick one-time sync in " + delaySeconds + "s");

        try {
            NotificationScheduler.scheduleQuickSync(getContext(), delaySeconds);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule quick sync", e);
            call.reject("Failed to schedule quick sync: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopPeriodicSync(com.getcapacitor.PluginCall call) {
        Log.d(TAG, "Stopping periodic sync");

        try {
            NotificationScheduler.cancelPeriodicSync(getContext());
            Log.d(TAG, "Periodic sync stopped successfully");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop periodic sync", e);
            call.reject("Failed to stop periodic sync: " + e.getMessage());
        }
    }

    @PluginMethod
    public void syncNow(com.getcapacitor.PluginCall call) {
        Log.d(TAG, "Running immediate sync");

        try {
            // Запускаем реальную синхронизацию через OneTimeWorkRequest
            Data inputData = new Data.Builder()
                .putBoolean("force_sync", true)
                .build();

            OneTimeWorkRequest syncWork = new OneTimeWorkRequest.Builder(BackgroundSyncWorker.class)
                .setInputData(inputData)
                .build();

            WorkManager.getInstance(getContext()).enqueue(syncWork);

            Log.d(TAG, "Immediate sync work enqueued");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to run immediate sync", e);
            call.reject("Failed to run immediate sync: " + e.getMessage());
        }
    }

    @PluginMethod
    public void checkPermission(com.getcapacitor.PluginCall call) {
        boolean hasPermission = PermissionHelper.hasNotificationPermission(getContext());
        JSObject result = new JSObject();
        result.put("granted", hasPermission);
        result.put("required", PermissionHelper.isNotificationPermissionRequired());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(com.getcapacitor.PluginCall call) {
        if (PermissionHelper.hasNotificationPermission(getContext())) {
            call.resolve();
            return;
        }

        if (PermissionHelper.isNotificationPermissionRequired()) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
        } else {
            call.resolve();
        }
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        if (PermissionHelper.hasNotificationPermission(getContext())) {
            call.resolve();
        } else {
            call.reject("Notification permission denied");
        }
    }

    @PluginMethod
    public void openSettings(com.getcapacitor.PluginCall call) {
        String type = call.getString("type", "app");

        if ("notification".equals(type)) {
            PermissionHelper.openNotificationSettings(getContext());
        } else {
            PermissionHelper.openAppSettings(getContext());
        }

        call.resolve();
    }

    @PluginMethod
    public void isSyncRunning(com.getcapacitor.PluginCall call) {
        boolean isRunning = NotificationScheduler.isPeriodicSyncRunning(getContext());
        JSObject result = new JSObject();
        result.put("running", isRunning);
        call.resolve(result);
    }
}
