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
                if (readNotificationsEnabled(context)) {
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

    /**
     * Чтение notificationsEnabled из CAPPreferences (TypeScript / @capacitor/preferences).
     * Fallback: нативный SharedPreferences (legacy).
     * Порядок: CAPPreferences v5 → PluginStorage v4 → нативный app_settings_v1.
     */
    private boolean readNotificationsEnabled(Context context) {
        for (String prefsName : new String[]{"CAPPreferences", "PluginStorage"}) {
            String raw = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                    .getString("app_settings_v1", null);
            if (raw != null) {
                try {
                    return new org.json.JSONObject(raw).optBoolean("notificationsEnabled", false);
                } catch (Exception ignored) {}
            }
        }
        return context.getSharedPreferences("app_settings_v1", Context.MODE_PRIVATE)
                .getBoolean("notificationsEnabled", false);
    }
}
