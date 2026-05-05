package com.kbp.journal;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * Helper class для управления разрешениями на разных версиях Android
 */
public class PermissionHelper {
    private static final String TAG = "PermissionHelper";
    private static final int NOTIFICATION_PERMISSION_CODE = 1001;
    private static final String PREFS_NAME = "PermissionPrefs";
    private static final String KEY_NOTIFICATION_PERMISSION_REQUESTED = "notification_permission_requested";

    /**
     * Проверяет, требуется ли запрос разрешения на уведомления (Android 13+)
     */
    public static boolean isNotificationPermissionRequired() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU;
    }

    /**
     * Проверяет, есть ли разрешение на уведомления
     */
    public static boolean hasNotificationPermission(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true; // На Android 12 и ниже разрешение не требуется
    }

    /**
     * Запрашивает разрешение на уведомления
     */
    public static void requestNotificationPermission(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(
                activity,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_CODE
            );
        }
    }

    /**
     * Проверяет, было ли уже запрошено разрешение (для отслеживания первого запроса)
     */
    public static boolean wasPermissionRequested(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_NOTIFICATION_PERMISSION_REQUESTED, false);
    }

    /**
     * Отмечает, что разрешение было запрошено
     */
    public static void markPermissionAsRequested(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_NOTIFICATION_PERMISSION_REQUESTED, true).apply();
    }

    /**
     * Проверяет, включено ли игнорирование оптимизации батареи (нужно для фоновой работы)
     */
    public static boolean isBatteryOptimizationDisabled(Context context) {
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return powerManager.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    /**
     * Открывает настройки приложения для запроса игнорирования оптимизации батареи
     */
    public static void requestBatteryOptimizationDisable(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent();
            intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
        }
    }

    /**
     * Открывает настройки уведомлений приложения
     */
    public static void openNotificationSettings(Context context) {
        Intent intent = new Intent();
        intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    /**
     * Открывает общие настройки приложения
     */
    public static void openAppSettings(Context context) {
        Intent intent = new Intent();
        intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", context.getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }
}
