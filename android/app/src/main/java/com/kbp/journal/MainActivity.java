package com.kbp.journal;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Локальный Java-плагин не входит в capacitor.plugins.json (его перезаписывает cap sync),
        // поэтому регистрируем вручную до создания Bridge.
        registerPlugin(NotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // Инициализация фоновой синхронизации при первом запуске
        initializeBackgroundSync();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Проверяем настройки при возврате в приложение
        checkAndStartBackgroundSync();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == 1001) {
            Log.d(TAG, "Notification permission result received");
            // Можно сохранить результат для статистики
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    /**
     * Инициализирует фоновую синхронизацию при первом запуске
     */
    private void initializeBackgroundSync() {
        SharedPreferences prefs = getSharedPreferences("app_settings_v1", MODE_PRIVATE);
        boolean wasInitialized = prefs.getBoolean("background_sync_initialized", false);

        if (!wasInitialized) {
            Log.d(TAG, "First launch - initializing background sync");

            // Запрашиваем разрешение на уведомления для Android 13+
            if (!PermissionHelper.hasNotificationPermission(this)) {
                if (!PermissionHelper.wasPermissionRequested(this)) {
                    PermissionHelper.markPermissionAsRequested(this);
                    PermissionHelper.requestNotificationPermission(this);
                    Log.d(TAG, "Notification permission requested");
                }
            }

            prefs.edit().putBoolean("background_sync_initialized", true).apply();
        }
    }

    /**
     * Проверяет настройки и запускает фоновую синхронизацию если нужно
     */
    private void checkAndStartBackgroundSync() {
        SharedPreferences prefs = getSharedPreferences("app_settings_v1", MODE_PRIVATE);
        boolean notificationsEnabled = prefs.getBoolean("notificationsEnabled", false);

        if (notificationsEnabled) {
            if (!NotificationScheduler.isPeriodicSyncRunning(this)) {
                Log.d(TAG, "Starting periodic background sync");
                NotificationScheduler.schedulePeriodicSync(this);
            }
        } else {
            // Если уведомления отключены - отменяем синхронизацию
            Log.d(TAG, "Notifications disabled, cancelling periodic sync");
            NotificationScheduler.cancelPeriodicSync(this);
        }
    }
}
