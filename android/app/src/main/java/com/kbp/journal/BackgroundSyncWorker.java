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
import java.io.DataOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class BackgroundSyncWorker extends Worker {

    private static final String TAG = "BackgroundSyncWorker";

    /*
     * Capacitor Preferences bridge:
     * @capacitor/preferences v5+  → "CAPPreferences"
     * @capacitor/preferences v4   → "PluginStorage"
     * Пробуем оба, берём тот где есть ej_cookies.
     */
    private static final String CAP_PREFS_V5 = "CAPPreferences";
    private static final String CAP_PREFS_V4 = "PluginStorage";

    // ─── Ключи (совпадают с storage.ts) ───────────────────────────────────────
    private static final String KEY_COOKIES           = "ej_cookies";
    private static final String KEY_LOGIN_DATA        = "ej_login_data";
    private static final String KEY_APP_SETTINGS      = "app_settings_v1";
    private static final String KEY_JOURNAL_CACHE     = "cached_journal_data";
    private static final String KEY_TIMETABLE_CACHE   = "cached_timetable_data";
    private static final String KEY_TIMETABLE_URL     = "cached_timetable_url";       // kbpApi.ts сохраняет после fetchTimetable
    private static final String KEY_TIMETABLE_ENTITY  = "cached_selected_timetable_result"; // backgroundSync.ts
    private static final String KEY_GROUP_ID          = "ej_group_id";
    private static final String KEY_LAST_SYNC         = "last_sync_time";

    // ─── Внутренние хэши Java-воркера ─────────────────────────────────────────
    private static final String KEY_LAST_JOURNAL_HASH   = "java_last_journal_hash";
    private static final String KEY_LAST_TIMETABLE_HASH = "java_last_timetable_hash";

    private static final String EJ_BASE       = "https://ej.kbp.by";
    private static final String EJ_LOGIN_PAGE = EJ_BASE + "/templates/login_parent.php";
    private static final String EJ_AJAX       = EJ_BASE + "/ajax.php";
    private static final String EJ_JOURNAL    = EJ_BASE + "/templates/parent_journal.php";
    private static final String KBP_TIMETABLE = "https://kbp.by/rasp/timetable/view_beta_kbp/";

    // Имя SharedPreferences, определяется один раз в ensureCapPrefsName()
    private String capPrefsName = null;

    public BackgroundSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Capacitor Preferences bridge
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Определение имени SharedPreferences для Capacitor:
     * v5 хранит в CAPPreferences, v4 — в PluginStorage.
     * Детектируем по наличию ключа ej_cookies.
     */
    private String ensureCapPrefsName() {
        if (capPrefsName != null) return capPrefsName;

        SharedPreferences v5 = getApplicationContext()
                .getSharedPreferences(CAP_PREFS_V5, Context.MODE_PRIVATE);
        if (v5.contains(KEY_COOKIES)) {
            Log.d(TAG, "Using CAPPreferences (Capacitor v5)");
            capPrefsName = CAP_PREFS_V5;
            return capPrefsName;
        }

        SharedPreferences v4 = getApplicationContext()
                .getSharedPreferences(CAP_PREFS_V4, Context.MODE_PRIVATE);
        if (v4.contains(KEY_COOKIES)) {
            Log.d(TAG, "Using PluginStorage (Capacitor v4)");
            capPrefsName = CAP_PREFS_V4;
            return capPrefsName;
        }

        // Ни в одном нет — логируем все ключи для отладки
        Log.e(TAG, "ej_cookies not found in CAPPreferences or PluginStorage!");
        Log.d(TAG, "CAPPreferences keys: " + v5.getAll().keySet().toString());
        Log.d(TAG, "PluginStorage keys:  " + v4.getAll().keySet().toString());

        capPrefsName = CAP_PREFS_V5; // fallback
        return capPrefsName;
    }

    private String capGet(String key) {
        return getApplicationContext()
                .getSharedPreferences(ensureCapPrefsName(), Context.MODE_PRIVATE)
                .getString(key, null);
    }

    private void capSet(String key, String value) {
        getApplicationContext()
                .getSharedPreferences(ensureCapPrefsName(), Context.MODE_PRIVATE)
                .edit().putString(key, value).apply();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Точка входа WorkManager
    // ══════════════════════════════════════════════════════════════════════════

    @Override
    @NonNull
    public Result doWork() {
        Log.d(TAG, "=== BackgroundSyncWorker START (attempt " + getRunAttemptCount() + ") ===");

        // Диагностика: покажем что есть в хранилище
        logStorageState();

        try {
            String settingsRaw       = capGet(KEY_APP_SETTINGS);
            boolean notificationsEnabled = false;
            boolean notifyJournal        = true;
            boolean notifyTimetable      = true;

            if (settingsRaw != null) {
                JSONObject s     = new JSONObject(settingsRaw);
                notificationsEnabled = s.optBoolean("notificationsEnabled", false);
                notifyJournal        = s.optBoolean("notifyJournal", true);
                notifyTimetable      = s.optBoolean("notifyTimetable", true);
            }

            boolean forceSync = getInputData().getBoolean("force_sync", false);
            Log.d(TAG, "notificationsEnabled=" + notificationsEnabled
                    + " notifyJournal=" + notifyJournal
                    + " notifyTimetable=" + notifyTimetable
                    + " forceSync=" + forceSync);

            if (!notificationsEnabled && !forceSync) {
                Log.d(TAG, "Notifications disabled — skip");
                return Result.success();
            }

            int changes = 0;

            // Расписание не требует авторизации — запускаем первым
            if (notifyTimetable) {
                changes += syncTimetable();
            }

            // Журнал требует сессии — получаем/восстанавливаем
            if (notifyJournal) {
                String cookies = ensureValidSession();
                if (cookies != null) {
                    changes += syncJournal(cookies);
                } else {
                    Log.w(TAG, "Could not get session for journal sync");
                }
            }

            capSet(KEY_LAST_SYNC, String.valueOf(System.currentTimeMillis()));
            Log.d(TAG, "=== BackgroundSyncWorker END, changes=" + changes + " ===");
            return Result.success();

        } catch (java.net.UnknownHostException | java.net.SocketTimeoutException e) {
            Log.w(TAG, "Network error — retry: " + e.getMessage());
            return Result.retry();
        } catch (Exception e) {
            Log.e(TAG, "Sync failed", e);
            return Result.failure();
        }
    }

    /** Дамп ключевых значений хранилища для отладки */
    private void logStorageState() {
        Log.d(TAG, "--- Storage state ---");
        Log.d(TAG, "ej_cookies:          " + (capGet(KEY_COOKIES)         != null ? "EXISTS" : "NULL"));
        Log.d(TAG, "ej_login_data:       " + (capGet(KEY_LOGIN_DATA)      != null ? "EXISTS" : "NULL"));
        Log.d(TAG, "cached_timetable_url:" + capGet(KEY_TIMETABLE_URL));
        Log.d(TAG, "cached_t_entity:     " + (capGet(KEY_TIMETABLE_ENTITY) != null ? "EXISTS" : "NULL"));
        Log.d(TAG, "ej_group_id:         " + capGet(KEY_GROUP_ID));
        Log.d(TAG, "app_settings:        " + capGet(KEY_APP_SETTINGS));
        Log.d(TAG, "---------------------");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Timetable sync — не требует авторизации
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Синхронизация расписания kbp.by:
     * 1. Определяет URL расписания из 3 источников по приоритету.
     * 2. Скачивает HTML.
     * 3. Хэширует только блоки пар (игнорирует динамические части).
     * 4. Сравнивает с прошлым хэшем → уведомление при изменении.
     */
    private int syncTimetable() {
        try {
            String url = resolveTimetableUrl();
            if (url == null) {
                Log.w(TAG, "syncTimetable: no URL available — open timetable tab in app first");
                return 0;
            }
            Log.d(TAG, "syncTimetable: fetching " + url);

            String html = fetchGet(url, null);
            if (html == null || html.length() < 500) {
                Log.w(TAG, "syncTimetable: response too short (" + (html == null ? 0 : html.length()) + " chars)");
                return 0;
            }

            // Хэшируем только блоки пар, а не всю страницу (динамические части не попадут)
            String pairsSection = extractPairsSection(html);
            Log.d(TAG, "syncTimetable: pairsSection length=" + pairsSection.length());

            String currentHash = sha256(pairsSection);
            String lastHash    = capGet(KEY_LAST_TIMETABLE_HASH);
            Log.d(TAG, "syncTimetable: currentHash=" + currentHash.substring(0, 8) + "... lastHash=" + (lastHash != null ? lastHash.substring(0, 8) + "..." : "NULL"));

            if (currentHash.equals(lastHash)) {
                Log.d(TAG, "syncTimetable: no changes");
                return 0;
            }

            if (lastHash == null) {
                // Первый запуск — сохраняем базовый хэш
                capSet(KEY_LAST_TIMETABLE_HASH, currentHash);
                Log.d(TAG, "syncTimetable: baseline saved");
                return 0;
            }

            // Изменения есть — формируем конкретное сообщение
            String msg = buildTimetableMessage(html);
            Log.d(TAG, "syncTimetable: CHANGE DETECTED — " + msg);
            showNotification("📅 Изменение в расписании", msg, NotificationWorker.CHANNEL_ID_TIMETABLE);
            capSet(KEY_LAST_TIMETABLE_HASH, currentHash);
            return 1;

        } catch (Exception e) {
            Log.e(TAG, "syncTimetable failed", e);
            return 0;
        }
    }

    /**
     * Определение URL расписания из 3 источников (по приоритету):
     * 1. cached_timetable_url  — сохранён kbpApi.ts после fetchTimetable
     * 2. cached_selected_timetable_result — {id, type} из backgroundSync.ts
     * 3. Грубый fallback через поиск по group_id на kbp.by
     */
    private String resolveTimetableUrl() {
        // Источник 1: прямой URL (kbpApi.ts сохраняет при открытии расписания)
        String directUrl = capGet(KEY_TIMETABLE_URL);
        if (directUrl != null && !directUrl.isEmpty()) {
            Log.d(TAG, "resolveTimetableUrl: using cached_timetable_url");
            return directUrl;
        }

        // Источник 2: выбранная сущность расписания (backgroundSync.ts)
        String entityRaw = capGet(KEY_TIMETABLE_ENTITY);
        if (entityRaw != null) {
            try {
                JSONObject entity = new JSONObject(entityRaw);
                String id   = entity.optString("id", "");
                String type = entity.optString("type", "group");
                if (!id.isEmpty()) {
                    String url = KBP_TIMETABLE + "?page=stable&cat=" + type + "&id=" + id;
                    Log.d(TAG, "resolveTimetableUrl: built from cached_selected_timetable_result → " + url);
                    return url;
                }
            } catch (Exception e) {
                Log.w(TAG, "resolveTimetableUrl: entity parse failed", e);
            }
        }

        // Источник 3: fallback — поиск на kbp.by по названию группы из ej_login_data
        try {
            String loginRaw = capGet(KEY_LOGIN_DATA);
            if (loginRaw != null) {
                JSONObject login   = new JSONObject(loginRaw);
                String groupId     = login.optString("group_id", "");
                String studentName = login.optString("student_name", "");
                if (!groupId.isEmpty()) {
                    String url = resolveKbpTimetableUrl(groupId, studentName);
                    if (url != null) {
                        Log.d(TAG, "resolveTimetableUrl: resolved via kbp.by search → " + url);
                        // Сохраняем чтобы в следующий раз не искать снова
                        capSet(KEY_TIMETABLE_URL, url);
                        return url;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "resolveTimetableUrl: fallback search failed", e);
        }

        Log.e(TAG, "resolveTimetableUrl: all sources exhausted");
        return null;
    }

    /**
     * Резолвинг URL расписания через kbp.by/search:
     * ищет группу по ID из ej.kbp.by → получает ID группы на kbp.by →
     * строит URL расписания.
     */
    private String resolveKbpTimetableUrl(String ejGroupId, String studentName) throws Exception {
        // Шаг 1: получаем список групп со страницы логина ej.kbp.by
        String loginHtml = fetchGet(EJ_LOGIN_PAGE, null);
        String groupName = extractGroupNameById(loginHtml, ejGroupId);
        if (groupName == null) {
            Log.w(TAG, "resolveKbpTimetableUrl: group name not found for id=" + ejGroupId);
            return null;
        }
        Log.d(TAG, "resolveKbpTimetableUrl: group name=" + groupName);

        // Шаг 2: ищем эту группу на kbp.by
        String searchUrl = "https://kbp.by/rasp/timetable/view_beta_kbp/data/search.php"
                + "?term=" + urlEncode(groupName) + "&type=group";
        String searchResponse = fetchGet(searchUrl, null);
        if (searchResponse == null || searchResponse.isEmpty()) return null;

        JSONArray results = new JSONArray(searchResponse);
        for (int i = 0; i < results.length(); i++) {
            JSONObject item  = results.getJSONObject(i);
            String    label  = item.optString("label", "");
            String    kbpId  = item.optString("id", "");
            if (!kbpId.isEmpty() && label.toLowerCase().contains(groupName.toLowerCase())) {
                return KBP_TIMETABLE + "?page=stable&cat=group&id=" + kbpId;
            }
        }
        return null;
    }

    /** Извлекает название группы из HTML страницы логина ej.kbp.by по её ID */
    private String extractGroupNameById(String html, String groupId) {
        if (html == null) return null;
        Pattern p = Pattern.compile(
                "<option[^>]*value\\s*=\\s*[\"']" + Pattern.quote(groupId) + "[\"'][^>]*>([^<]+)</option>",
                Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(html);
        return m.find() ? m.group(1).trim() : null;
    }

    /**
     * Извлечение блоков пар расписания для хэширования:
     * берёт только div/td с классом pair, чтобы не реагировать
     * на изменение шапки, времени генерации и других динамических частей.
     */
    private String extractPairsSection(String html) {
        StringBuilder sb = new StringBuilder();

        // Блоки с классом pair (основная разметка kbp.by)
        Pattern p = Pattern.compile(
                "<(?:div|td)[^>]*class\\s*=\\s*[\"'][^\"']*\\bpair\\b[^\"']*[\"'][^>]*>[\\s\\S]*?</(?:div|td)>",
                Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(html);
        while (m.find()) sb.append(m.group());

        if (sb.length() > 0) return sb.toString();

        // Fallback: вся таблица расписания
        int start = html.indexOf("<table");
        int end   = html.lastIndexOf("</table>");
        if (start != -1 && end > start) return html.substring(start, end + 8);

        return html;
    }

    /**
     * Формирование текста уведомления об изменении расписания:
     * ищет классы added/removed/changed в HTML.
     */
    private String buildTimetableMessage(String html) {
        boolean hasAdded   = html.contains("pair added")   || html.contains("pair  added");
        boolean hasRemoved = html.contains("pair removed") || html.contains("pair  removed");
        boolean hasChanged = html.contains("pair changed") || html.contains("pair  changed");

        if (hasAdded && hasRemoved) return "Добавлены и сняты пары";
        if (hasAdded)   return "Добавлены новые пары";
        if (hasRemoved) return "Сняты пары из расписания";
        if (hasChanged) return "Изменения в расписании";
        return "Обновлено расписание";
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Journal sync
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Синхронизация журнала оценок:
     * скачивает HTML → хэширует строки <tr class="mark mar rowN"> →
     * сравнивает с прошлым хэшем → считает новые оценки → уведомление.
     */
    private int syncJournal(String cookies) {
        try {
            String html = fetchGet(EJ_JOURNAL, cookies);
            if (!isJournalPage(html)) {
                Log.w(TAG, "syncJournal: response is not journal (length=" + (html != null ? html.length() : 0) + ")");
                return 0;
            }

            String marksSection = extractMarksSection(html);
            String currentHash  = sha256(marksSection);
            String lastHash     = capGet(KEY_LAST_JOURNAL_HASH);
            Log.d(TAG, "syncJournal: currentHash=" + currentHash.substring(0, 8) + "... lastHash=" + (lastHash != null ? lastHash.substring(0, 8) + "..." : "NULL"));

            if (currentHash.equals(lastHash)) {
                Log.d(TAG, "syncJournal: no changes");
                return 0;
            }

            if (lastHash == null) {
                capSet(KEY_LAST_JOURNAL_HASH, currentHash);
                Log.d(TAG, "syncJournal: baseline saved");
                return 0;
            }

            int newCount = countNewMarks(html, capGet(KEY_JOURNAL_CACHE));
            String msg   = newCount > 0
                    ? "Появилось " + newCount + " новых оценок!"
                    : "Изменились оценки в журнале";

            Log.d(TAG, "syncJournal: CHANGE DETECTED — " + msg);
            showNotification("📚 Обновление журнала", msg, NotificationWorker.CHANNEL_ID_JOURNAL);
            capSet(KEY_LAST_JOURNAL_HASH, currentHash);
            return Math.max(1, newCount);

        } catch (Exception e) {
            Log.e(TAG, "syncJournal failed", e);
            return 0;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Session management
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Обеспечение валидной сессии:
     * пробует текущие cookies → если журнал доступен, возвращает их.
     * Иначе вызывает relogin() → повторяет проверку.
     */
    private String ensureValidSession() throws Exception {
        String cookies = capGet(KEY_COOKIES);
        if (cookies != null) {
            String html = fetchGet(EJ_JOURNAL, cookies);
            if (isJournalPage(html)) {
                Log.d(TAG, "ensureValidSession: existing cookies valid");
                return cookies;
            }
        }

        Log.d(TAG, "ensureValidSession: session invalid, re-logging in");
        String fresh = relogin();
        if (fresh == null) return null;

        String html = fetchGet(EJ_JOURNAL, fresh);
        return isJournalPage(html) ? fresh : null;
    }

    /**
     * Переавторизация через ej.kbp.by:
     * GET login_parent.php → парсит S_Code →
     * POST ajax.php с credentials → сохраняет cookies в CAPPreferences.
     */
    private String relogin() throws Exception {
        String raw = capGet(KEY_LOGIN_DATA);
        if (raw == null) {
            Log.e(TAG, "relogin: KEY_LOGIN_DATA is null");
            return null;
        }

        JSONObject creds   = new JSONObject(raw);
        String studentName = creds.optString("student_name", "");
        String groupId     = creds.optString("group_id", "");
        String birthDay    = creds.optString("birth_day", "");

        Log.d(TAG, "relogin: studentName=" + studentName + " groupId=" + groupId + " birthDay=" + birthDay);

        if (studentName.isEmpty() || groupId.isEmpty() || birthDay.isEmpty()) {
            Log.e(TAG, "relogin: credentials incomplete");
            return null;
        }

        // Шаг 1: GET login_parent.php → S_Code + initial cookies
        HttpURLConnection loginConn = openGet(EJ_LOGIN_PAGE + "?_=" + System.currentTimeMillis(), null);
        String initialCookies = joinSetCookies(loginConn.getHeaderFields().get("Set-Cookie"));
        String loginHtml      = readBody(loginConn);
        loginConn.disconnect();

        String sCode = parseSCode(loginHtml);
        Log.d(TAG, "relogin: S_Code=" + sCode);
        if (sCode == null) {
            Log.e(TAG, "relogin: S_Code not found in login page");
            return null;
        }

        // Шаг 2: POST ajax.php
        String body = "action=login_parent"
                + "&S_Code="       + urlEncode(sCode)
                + "&student_name=" + urlEncode(studentName)
                + "&group_id="     + urlEncode(groupId)
                + "&birth_day="    + urlEncode(birthDay);

        HttpURLConnection ajax = openPost(EJ_AJAX, initialCookies, body);
        String ajaxCookies  = joinSetCookies(ajax.getHeaderFields().get("Set-Cookie"));
        String ajaxResponse = readBody(ajax);
        ajax.disconnect();

        Log.d(TAG, "relogin: ajax response=" + ajaxResponse.trim());

        if (!ajaxResponse.toLowerCase().contains("good")) {
            Log.e(TAG, "relogin: server rejected credentials");
            return null;
        }

        String sessionCookies = (ajaxCookies != null && !ajaxCookies.isEmpty())
                ? ajaxCookies : initialCookies;

        if (sessionCookies == null || sessionCookies.isEmpty()) {
            Log.e(TAG, "relogin: no cookies in response");
            return null;
        }

        capSet(KEY_COOKIES, sessionCookies);
        Log.d(TAG, "relogin: SUCCESS");
        return sessionCookies;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HTML parsing helpers
    // ══════════════════════════════════════════════════════════════════════════

    private boolean isJournalPage(String html) {
        return html != null && (
                html.contains("pupilName") ||
                html.contains("dateOfMonth") ||
                html.contains("mark mar row"));
    }

    private String extractMarksSection(String html) {
        StringBuilder sb = new StringBuilder();
        Matcher m = Pattern.compile(
                "<tr[^>]*class=\"mark mar row\\d+\"[^>]*>[\\s\\S]*?</tr>",
                Pattern.CASE_INSENSITIVE).matcher(html);
        while (m.find()) sb.append(m.group());
        return sb.length() > 0 ? sb.toString() : html;
    }

    private int countNewMarks(String newHtml, String oldJson) {
        int newCount = 0;
        Matcher m = Pattern.compile(
                "<span[^>]*class=\"mar\"[^>]*>[^<]+</span>",
                Pattern.CASE_INSENSITIVE).matcher(newHtml);
        while (m.find()) newCount++;

        if (oldJson == null) return 0;
        try {
            JSONArray subjects = new JSONObject(oldJson).optJSONArray("subjects");
            if (subjects == null) return Math.max(0, newCount);
            int oldCount = 0;
            for (int i = 0; i < subjects.length(); i++) {
                JSONObject matrix = subjects.getJSONObject(i).optJSONObject("gradesMatrix");
                if (matrix == null) continue;
                for (Iterator<String> it = matrix.keys(); it.hasNext(); ) {
                    JSONArray grades = matrix.optJSONArray(it.next());
                    if (grades != null) oldCount += grades.length();
                }
            }
            return Math.max(0, newCount - oldCount);
        } catch (Exception e) {
            return 0;
        }
    }

    private String parseSCode(String html) {
        Pattern[] patterns = {
            Pattern.compile("id\\s*=\\s*[\"']S_Code[\"'][^>]*value\\s*=\\s*[\"']([a-f0-9]{32})[\"']", Pattern.CASE_INSENSITIVE),
            Pattern.compile("value\\s*=\\s*[\"']([a-f0-9]{32})[\"'][^>]*id\\s*=\\s*[\"']S_Code[\"']", Pattern.CASE_INSENSITIVE),
        };
        for (Pattern p : patterns) {
            Matcher m = p.matcher(html);
            if (m.find()) return m.group(1);
        }
        // Fallback: ищем рядом с текстом "S_Code"
        int idx = html.indexOf("S_Code");
        if (idx != -1) {
            String snippet = html.substring(Math.max(0, idx - 50), Math.min(html.length(), idx + 200));
            Matcher m = Pattern.compile("value\\s*=\\s*[\"']([a-f0-9]{32})[\"']", Pattern.CASE_INSENSITIVE).matcher(snippet);
            if (m.find()) return m.group(1);
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HTTP helpers
    // ══════════════════════════════════════════════════════════════════════════

    private String fetchGet(String urlStr, String cookies) throws Exception {
        HttpURLConnection conn = openGet(urlStr, cookies);
        String body = readBody(conn);
        conn.disconnect();
        return body;
    }

    private HttpURLConnection openGet(String urlStr, String cookies) throws Exception {
        HttpURLConnection conn = openConnection(urlStr);
        conn.setRequestMethod("GET");
        setCommonHeaders(conn, cookies);
        conn.connect();
        return conn;
    }

    private HttpURLConnection openPost(String urlStr, String cookies, String formBody) throws Exception {
        HttpURLConnection conn = openConnection(urlStr);
        conn.setRequestMethod("POST");
        setCommonHeaders(conn, cookies);
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        conn.setRequestProperty("Origin", EJ_BASE);
        conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        conn.setDoOutput(true);
        conn.connect();
        try (DataOutputStream out = new DataOutputStream(conn.getOutputStream())) {
            out.writeBytes(formBody);
        }
        return conn;
    }

    private HttpURLConnection openConnection(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(15_000);
        conn.setInstanceFollowRedirects(true);
        return conn;
    }

    private void setCommonHeaders(HttpURLConnection conn, String cookies) {
        conn.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36");
        conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,*/*;q=0.8");
        conn.setRequestProperty("Accept-Language", "ru,en;q=0.9");
        conn.setRequestProperty("Referer", EJ_BASE + "/");
        conn.setRequestProperty("Cache-Control", "no-cache, no-store, must-revalidate");
        conn.setRequestProperty("Pragma", "no-cache");
        if (cookies != null && !cookies.isEmpty()) {
            conn.setRequestProperty("Cookie", cookies);
        }
    }

    private String readBody(HttpURLConnection conn) throws Exception {
        int code       = conn.getResponseCode();
        InputStream is = code < 400 ? conn.getInputStream() : conn.getErrorStream();
        if (is == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder  sb     = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line).append('\n');
        reader.close();
        return sb.toString();
    }

    private String joinSetCookies(List<String> headers) {
        if (headers == null || headers.isEmpty()) return null;
        StringBuilder sb = new StringBuilder();
        for (String h : headers) {
            String pair = h.split(";")[0].trim();
            if (pair.contains("=")) {
                if (sb.length() > 0) sb.append("; ");
                sb.append(pair);
            }
        }
        return sb.length() > 0 ? sb.toString() : null;
    }

    private String urlEncode(String s) {
        try { return java.net.URLEncoder.encode(s, "UTF-8"); }
        catch (Exception e) { return s; }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Utils
    // ══════════════════════════════════════════════════════════════════════════

    private String sha256(String data) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(data.getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return String.valueOf(data.hashCode());
        }
    }

    private void showNotification(String title, String body, String channelId) {
        NotificationScheduler.scheduleImmediateNotification(
                getApplicationContext(), title, body, channelId);
    }
}