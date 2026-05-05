package com.kbp.journal;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class BackgroundSyncWorker extends Worker {
    private static final String TAG = "BackgroundSyncWorker";
    private static final String PREFS_NAME = "BackgroundSyncPrefs";
    private static final String KEY_LAST_JOURNAL_HASH = "last_journal_hash";
    private static final String KEY_LAST_TIMETABLE_HASH = "last_timetable_hash";
    private static final String KEY_LAST_JOURNAL_DATA = "last_journal_data";
    private static final String KEY_LAST_SYNC_TIME = "last_sync_time";

    // Настройки API - замените на ваши реальные URL
    private static final String API_BASE_URL = "https://dnevnik.mos.ru";
    private static final String API_JOURNAL_ENDPOINT = "/api/v3/journal";
    private static final String API_TIMETABLE_ENDPOINT = "/api/v3/timetable";

    public BackgroundSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @Override
    @NonNull
    public Result doWork() {
        Log.d(TAG, "Starting background sync (attempt " + getRunAttemptCount() + ")");

        try {
            Context context = getApplicationContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            // Загружаем настройки
            SharedPreferences mainPrefs = context.getSharedPreferences("app_settings_v1", Context.MODE_PRIVATE);
            boolean notificationsEnabled = mainPrefs.getBoolean("notificationsEnabled", false);
            boolean notifyJournal = mainPrefs.getBoolean("notifyJournal", true);
            boolean notifyTimetable = mainPrefs.getBoolean("notifyTimetable", true);
            String groupId = mainPrefs.getString("ej_group_id", null);
            String authToken = mainPrefs.getString("auth_token", null);

            boolean forceSync = getInputData().getBoolean("force_sync", false);

            if (!notificationsEnabled && !forceSync) {
                Log.d(TAG, "Notifications disabled, skipping sync");
                return Result.success();
            }

            int changesCount = 0;

            // Синхронизация журнала
            if (notifyJournal && authToken != null) {
                changesCount += syncJournal(prefs, authToken);
            }

            // Синхронизация расписания
            if (notifyTimetable && groupId != null && !groupId.isEmpty() && authToken != null) {
                changesCount += syncTimetable(prefs, groupId, authToken);
            }

            // Сохраняем время последней синхронизации
            prefs.edit()
                .putLong(KEY_LAST_SYNC_TIME, System.currentTimeMillis())
                .apply();

            Log.d(TAG, "Background sync completed, detected " + changesCount + " changes");
            return Result.success();

        } catch (Exception e) {
            Log.e(TAG, "Background sync failed", e);
            // При ошибке аутентификации или сети можно вернуть retry
            if (e instanceof java.net.UnknownHostException || e instanceof java.net.SocketTimeoutException) {
                return Result.retry();
            }
            return Result.failure();
        }
    }

    /**
     * Синхронизация журнала оценок
     */
    private int syncJournal(SharedPreferences prefs, String authToken) {
        try {
            String apiUrl = API_BASE_URL + API_JOURNAL_ENDPOINT;
            String currentData = fetchFromApi(apiUrl, authToken);

            if (currentData == null || currentData.isEmpty()) {
                Log.w(TAG, "Journal API returned empty data");
                return 0;
            }

            String currentHash = computeHash(currentData);
            String lastHash = prefs.getString(KEY_LAST_JOURNAL_HASH, "");
            String lastData = prefs.getString(KEY_LAST_JOURNAL_DATA, "");

            if (!currentHash.equals(lastHash) && !lastHash.isEmpty()) {
                // Обнаружены изменения - сравниваем и показываем уведомление
                int newMarksCount = countNewMarks(lastData, currentData);

                if (newMarksCount > 0) {
                    showJournalNotification("Появилось " + newMarksCount + " новых оценок!");
                    Log.d(TAG, "Journal changes detected: " + newMarksCount + " new marks");
                }

                // Сохраняем новые данные
                prefs.edit()
                    .putString(KEY_LAST_JOURNAL_HASH, currentHash)
                    .putString(KEY_LAST_JOURNAL_DATA, currentData)
                    .apply();

                return newMarksCount;
            }

            // Первая синхронизация - сохраняем данные без уведомления
            if (lastHash.isEmpty()) {
                prefs.edit()
                    .putString(KEY_LAST_JOURNAL_HASH, currentHash)
                    .putString(KEY_LAST_JOURNAL_DATA, currentData)
                    .apply();
                Log.d(TAG, "Journal data saved (initial sync)");
            }

            return 0;

        } catch (Exception e) {
            Log.e(TAG, "Journal sync failed", e);
            return 0;
        }
    }

    /**
     * Синхронизация расписания уроков
     */
    private int syncTimetable(SharedPreferences prefs, String groupId, String authToken) {
        try {
            String apiUrl = API_BASE_URL + API_TIMETABLE_ENDPOINT + "?group_id=" + groupId;
            String currentData = fetchFromApi(apiUrl, authToken);

            if (currentData == null || currentData.isEmpty()) {
                Log.w(TAG, "Timetable API returned empty data");
                return 0;
            }

            String currentHash = computeHash(currentData);
            String lastHash = prefs.getString(KEY_LAST_TIMETABLE_HASH, "");

            if (!currentHash.equals(lastHash) && !lastHash.isEmpty()) {
                // Обнаружены изменения в расписании
                String changes = detectTimetableChanges(lastData(prefs), currentData);

                if (changes != null && !changes.isEmpty()) {
                    showTimetableNotification(changes);
                    Log.d(TAG, "Timetable changes detected: " + changes);
                }

                prefs.edit()
                    .putString(KEY_LAST_TIMETABLE_HASH, currentHash)
                    .apply();

                return 1;
            }

            // Первая синхронизация
            if (lastHash.isEmpty()) {
                prefs.edit()
                    .putString(KEY_LAST_TIMETABLE_HASH, currentHash)
                    .apply();
                Log.d(TAG, "Timetable data saved (initial sync)");
            }

            return 0;

        } catch (Exception e) {
            Log.e(TAG, "Timetable sync failed", e);
            return 0;
        }
    }

    /**
     * GET запрос к API
     */
    private String fetchFromApi(String urlString, String authToken) throws Exception {
        Log.d(TAG, "Fetching from API: " + urlString);

        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();

        try {
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Authorization", "Bearer " + authToken);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("User-Agent", "MiniKBP-Android/1.0");

            int responseCode = connection.getResponseCode();

            if (responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
                throw new RuntimeException("Authentication failed - token expired");
            }

            if (responseCode != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "API response code: " + responseCode);
                return null;
            }

            BufferedReader reader = new BufferedReader(
                new InputStreamReader(connection.getInputStream())
            );
            StringBuilder response = new StringBuilder();
            String line;

            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
            reader.close();

            return response.toString();

        } finally {
            connection.disconnect();
        }
    }

    /**
     * Вычисление хэша строки (SHA-256)
     */
    private String computeHash(String data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(data.getBytes());
            StringBuilder hexHash = new StringBuilder();
            for (byte b : hash) {
                hexHash.append(String.format("%02x", b));
            }
            return hexHash.toString();
        } catch (Exception e) {
            Log.e(TAG, "Hash computation failed", e);
            return String.valueOf(data.hashCode());
        }
    }

    /**
     * Подсчёт новых оценок
     */
    private int countNewMarks(String oldData, String newData) {
        try {
            JSONObject oldJson = new JSONObject(oldData);
            JSONObject newJson = new JSONObject(newData);

            JSONArray oldMarks = oldJson.optJSONArray("marks");
            JSONArray newMarks = newJson.optJSONArray("marks");

            if (oldMarks == null || newMarks == null) {
                return Math.max(
                    newMarks != null ? newMarks.length() : 0,
                    oldMarks != null ? oldMarks.length() : 0
                );
            }

            int count = 0;
            for (int i = 0; i < newMarks.length(); i++) {
                JSONObject newMark = newMarks.getJSONObject(i);
                String newId = newMark.optString("id", "");

                boolean found = false;
                for (int j = 0; j < oldMarks.length(); j++) {
                    JSONObject oldMark = oldMarks.getJSONObject(j);
                    if (oldMark.optString("id", "").equals(newId)) {
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    count++;
                }
            }

            return count;

        } catch (Exception e) {
            Log.e(TAG, "Error counting new marks", e);
            return 0;
        }
    }

    /**
     * Определение изменений в расписании
     */
    private String detectTimetableChanges(String oldData, String newData) {
        try {
            JSONObject oldJson = new JSONObject(oldData);
            JSONObject newJson = new JSONObject(newData);

            JSONArray oldLessons = oldJson.optJSONArray("lessons");
            JSONArray newLessons = newJson.optJSONArray("lessons");

            if (newLessons == null) return null;

            // Проверяем изменения на завтра
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            String tomorrow = sdf.format(new Date(System.currentTimeMillis() + 86400000));

            StringBuilder changes = new StringBuilder();

            for (int i = 0; i < newLessons.length(); i++) {
                JSONObject lesson = newLessons.getJSONObject(i);
                String date = lesson.optString("date", "");

                if (date.equals(tomorrow)) {
                    String subject = lesson.optString("subject", "Урок");
                    String time = lesson.optString("startTime", "");
                    changes.append(subject).append(" в ").append(time).append("\n");
                }
            }

            if (changes.length() > 0) {
                return "Изменения на завтра:\n" + changes.toString().trim();
            }

        } catch (Exception e) {
            Log.e(TAG, "Error detecting timetable changes", e);
        }

        return null;
    }

    private String lastData(SharedPreferences prefs) {
        return prefs.getString(KEY_LAST_JOURNAL_DATA, "{}");
    }

    /**
     * Показ уведомления об обновлении журнала
     */
    private void showJournalNotification(String message) {
        Context context = getApplicationContext();
        NotificationScheduler.scheduleImmediateNotification(
            context,
            "📚 Обновление журнала",
            message,
            NotificationWorker.CHANNEL_ID_JOURNAL
        );
    }

    /**
     * Показ уведомления об обновлении расписания
     */
    private void showTimetableNotification(String message) {
        Context context = getApplicationContext();
        NotificationScheduler.scheduleImmediateNotification(
            context,
            "📅 Обновление расписания",
            message,
            NotificationWorker.CHANNEL_ID_TIMETABLE
        );
    }

    /**
     * Получение текущего времени в читаемом формате
     */
    private String getCurrentTimestamp() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault());
        return sdf.format(new Date());
    }
}
