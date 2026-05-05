package com.kbp.journal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d(TAG, "Device boot completed, restarting background sync");

            try {
                // Проверяем настройки
                SharedPreferences mainPrefs = context.getSharedPreferences("app_settings_v1", Context.MODE_PRIVATE);
                boolean notificationsEnabled = mainPrefs.getBoolean("notificationsEnabled", false);

                if (notificationsEnabled) {
                    // Запускаем периодическую синхронизацию
                    NotificationScheduler.schedulePeriodicSync(context);
                    Log.d(TAG, "Background sync restarted after boot");
                } else {
                    Log.d(TAG, "Notifications disabled, not restarting sync");
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to restart background sync after boot", e);
            }
        }
    }
}
