import { getKbpPairTime } from "@/lib/client/kbpBellSchedule";
import { isNativeApp } from "@/lib/client/platform";
import { extractCookiePairs, nativeRequestText } from "@/lib/client/nativeHttp";
import { storageGet, storageSet } from "@/lib/client/storage";

export type Group = { id: string; name: string };

// Storage keys
const STORAGE_KEYS = {
  JOURNAL_DATA: "cached_journal_data",
  TIMETABLE_DATA: "cached_timetable_data",
  STUDENT_FIO: "cached_student_fio",
  LAST_JOURNAL_FETCH: "last_journal_fetch",
  LAST_TIMETABLE_FETCH: "last_timetable_fetch",
  GROUPS_CACHE: "cached_ej_groups",
  LAST_GROUPS_FETCH: "last_groups_fetch",
} as const;

export async function getGroups(): Promise<Group[]> {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const [cachedGroupsRaw, cachedAtRaw] = await Promise.all([
    storageGet(STORAGE_KEYS.GROUPS_CACHE),
    storageGet(STORAGE_KEYS.LAST_GROUPS_FETCH),
  ]);

  let cachedGroups: Group[] = [];
  if (cachedGroupsRaw) {
    try {
      const parsed = JSON.parse(cachedGroupsRaw);
      if (Array.isArray(parsed)) cachedGroups = parsed.filter((g: any) => g?.id && g?.name);
    } catch {}
  }

  const cachedAt = Number(cachedAtRaw || "0");
  const isFreshCache = cachedGroups.length > 0 && Number.isFinite(cachedAt) && Date.now() - cachedAt < WEEK_MS;
  if (isFreshCache) return cachedGroups;

  let lastError: unknown = null;
  let saw403 = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let groups: Group[] = [];
      if (!isNativeApp()) {
        const res = await fetch("/api/groups");
        const json = await res.json();
        if (json?.success && Array.isArray(json.groups)) groups = json.groups;
      } else {
        const timestamp = Date.now();
        const r = await nativeRequestText({
          url: `https://ej.kbp.by/templates/login_parent.php?_=${timestamp}`,
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
            Referer: "https://ej.kbp.by/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        });

        if (r.status === 403) {
          saw403 = true;
        } else {
          const optionMatches = r.data.matchAll(/<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/g);
          for (const m of optionMatches) {
            const id = m[1];
            const name = m[2].trim();
            if (id && name) groups.push({ id, name });
          }
        }
      }

      if (groups.length > 0) {
        await Promise.all([
          storageSet(STORAGE_KEYS.GROUPS_CACHE, JSON.stringify(groups)),
          storageSet(STORAGE_KEYS.LAST_GROUPS_FETCH, Date.now().toString()),
        ]);
        return groups;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (cachedGroups.length > 0) return cachedGroups;
  if (saw403) throw new Error("KBP_403");
  if (lastError) throw lastError;
  throw new Error("GROUPS_UNAVAILABLE");
}

function parseSCode(html: string): string {
  const patterns = [
    /<input[^>]*id\s*=\s*["']S_Code["'][^>]*value\s*=\s*["']([^"']+)["']/i,
    /<input[^>]*value\s*=\s*["']([^"']+)["'][^>]*id\s*=\s*["']S_Code["']/i,
    /id\s*=\s*["']S_Code["'][^>]*value\s*=\s*["']([a-f0-9]{32})["']/i,
    /S_Code["'][^>]*value\s*=\s*["']([a-f0-9]{32})["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1] && m[1].length === 32) return m[1];
  }
  const idx = html.indexOf("S_Code");
  if (idx !== -1) {
    const snippet = html.substring(Math.max(0, idx - 50), Math.min(html.length, idx + 150));
    const m = snippet.match(/value\s*=\s*["']([a-f0-9]{32})["']/i);
    if (m?.[1]) return m[1];
  }
  throw new Error("S_Code value not found");
}

function parseFioFromJournalHtml(html: string): string | null {
  const navLinkMatch = html.match(/<a[^>]*href=["']parent_journal\.php["'][^>]*>([^<]+)<\/a>/i);
  if (navLinkMatch?.[1]) {
    const linkText = navLinkMatch[1].trim();
    const fioMatch = linkText.match(/[–—-]\s*(.+)$/);
    if (fioMatch?.[1]) return fioMatch[1].trim();
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = titleMatch[1]
      .replace(/&ndash;|&#8211;/gi, "–")
      .replace(/&mdash;|&#8212;/gi, "—")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const fioMatch = title.match(/[–—-]\s*([^–—-][^<]+)$/);
    if (fioMatch?.[1]) return fioMatch[1].trim();
  }

  return null;
}

export async function login(input: {
  student_name: string;
  group_id: string;
  birth_day: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isNativeApp()) {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await res.json();
  }

  // Native mode: сохраняем cookies вручную (нужно для последующих запросов)
  const timestamp = Date.now();
  const loginPage = await nativeRequestText({
    url: `https://ej.kbp.by/templates/login_parent.php?_=${timestamp}`,
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://ej.kbp.by/",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    },
  });

  const sCode = parseSCode(loginPage.data);
  const initialCookiePairs = extractCookiePairs(loginPage.headers["set-cookie"] || loginPage.headers["setcookie"]);
  const initialCookies = initialCookiePairs.join("; ");

  const formData = new URLSearchParams();
  formData.append("action", "login_parent");
  formData.append("S_Code", sCode);
  formData.append("student_name", input.student_name);
  formData.append("group_id", input.group_id);
  formData.append("birth_day", input.birth_day);
  const formDataString = formData.toString();

  const ajax = await nativeRequestText({
    url: "https://ej.kbp.by/ajax.php",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://ej.kbp.by/",
      Origin: "https://ej.kbp.by",
      "X-Requested-With": "XMLHttpRequest",
      ...(initialCookies ? { Cookie: initialCookies } : {}),
    },
    data: formDataString,
  });

  const isSuccess = ajax.data.toLowerCase().includes("good");
  const ajaxCookiePairs = extractCookiePairs(ajax.headers["set-cookie"] || ajax.headers["setcookie"]);
  const sessionCookies = (ajaxCookiePairs.length > 0 ? ajaxCookiePairs : initialCookiePairs).join("; ");

  if (isSuccess && sessionCookies) {
    await storageSet("ej_cookies", sessionCookies);
  }

  return isSuccess ? { success: true } : { success: false, error: "Ошибка входа. Проверьте данные." };
}

/**
 * Автоматическая переавторизация:
 * читает сохранённые credentials из ej_login_data → вызывает login() → возвращает успех/провал.
 * Используется как fallback при протухшей сессии.
 */
async function autoRelogin(): Promise<boolean> {
  console.log("[KBP] Session expired, attempting auto re-login...");
  try {
    const loginDataRaw = await storageGet("ej_login_data");
    if (!loginDataRaw) {
      console.warn("[KBP] autoRelogin: no saved credentials in ej_login_data");
      return false;
    }

    const loginData = JSON.parse(loginDataRaw) as {
      student_name: string;
      group_id: string;
      birth_day: string;
    };

    if (!loginData.student_name || !loginData.group_id || !loginData.birth_day) {
      console.warn("[KBP] autoRelogin: credentials incomplete", loginData);
      return false;
    }

    const result = await login(loginData);
    if (result.success) {
      console.log("[KBP] autoRelogin: success");
      return true;
    }

    console.warn("[KBP] autoRelogin: login() returned failure:", result.error);
    return false;
  } catch (err) {
    console.error("[KBP] autoRelogin: unexpected error:", err);
    return false;
  }
}

// Parse FIO from parent_journal.php navbar link
// <a href="parent_journal.php">Т-494 – Лагун Александр Сергеевич</a>
export async function fetchStudentFIO(): Promise<{ success: boolean; fio?: string; error?: string }> {
  console.log("[KBP] Fetching student FIO from navbar...");

  /**
   * Единый HTTP-запрос за FIO:
   * возвращает fio-строку или null если сессия протухла / FIO не распарсился.
   */
  const doRequest = async (): Promise<string | null> => {
    const cookies = await storageGet("ej_cookies");
    const r = await nativeRequestText({
      url: "https://ej.kbp.by/templates/parent_journal.php",
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.9",
        Referer: "https://ej.kbp.by/",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    return parseFioFromJournalHtml(r.data);
  };

  try {
    let fio = await doRequest();

    // Сессия протухла — пробуем переавторизоваться и повторить
    if (!fio) {
      const reloggedIn = await autoRelogin();
      if (reloggedIn) {
        fio = await doRequest();
      }
    }

    if (fio) {
      console.log("[KBP] Parsed FIO:", fio);
      await storageSet(STORAGE_KEYS.STUDENT_FIO, fio);
      return { success: true, fio };
    }

    console.log("[KBP] Could not parse FIO from navbar or title");
    return { success: false, error: "FIO not found" };
  } catch (err) {
    console.error("[KBP] Error fetching FIO:", err);
    return { success: false, error: String(err) };
  }
}

// Get cached FIO
export async function getCachedFIO(): Promise<string | null> {
  return await storageGet(STORAGE_KEYS.STUDENT_FIO);
}

export type JournalMark = { value: string; type: string; kind?: "normal" | "alert" };
export type JournalData = any;

/** Старый кэш без поля kind — нужно перекачать журнал с сервера */
export function journalDataNeedsKindRefresh(data: unknown): boolean {
  const subjects = (data as { subjects?: unknown })?.subjects;
  if (!Array.isArray(subjects)) return false;
  for (const subject of subjects) {
    const matrix = (subject as { gradesMatrix?: Record<string, unknown> })?.gradesMatrix;
    if (!matrix || typeof matrix !== "object") continue;
    for (const grades of Object.values(matrix)) {
      if (!Array.isArray(grades) || grades.length === 0) continue;
      for (const g of grades) {
        if (g && typeof g === "object" && !("kind" in g)) return true;
      }
    }
  }
  return false;
}

/** Красный цвет для alert_m (inline — не зависит от Tailwind) */
export function journalMarkAlertStyle(kind?: "normal" | "alert"): {
  color?: string;
  fontWeight?: number;
} {
  if (kind === "alert") return { color: "#dc2626", fontWeight: 700 };
  return {};
}

export async function fetchJournal(): Promise<{ success: boolean; data?: JournalData; error?: string }> {
  console.log("[KBP] fetchJournal called");

  if (!isNativeApp()) {
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return await res.json();
  }

  /**
   * Единый HTTP-запрос за журналом:
   * возвращает распарсенный объект или null если сессия протухла / данных нет.
   */
  const doRequest = async (): Promise<{ html: string; parsed: any } | null> => {
    const cookies = await storageGet("ej_cookies");
    const cookieHeader = cookies && cookies.trim() !== "" ? cookies : undefined;
    const r = await nativeRequestText({
      url: "https://ej.kbp.by/templates/parent_journal.php",
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "ru,en;q=0.9",
        Referer: "https://ej.kbp.by/parent_journal.php",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });

    // Восстанавливаем cookies из ответа если их не было
    if (!cookieHeader) {
      const recoveredPairs = extractCookiePairs(r.headers["set-cookie"] || r.headers["setcookie"]);
      if (recoveredPairs.length > 0) {
        await storageSet("ej_cookies", recoveredPairs.join("; "));
      }
    }

    const html = r.data;
    const isJournalAvailable =
      html.includes("pupilName") ||
      html.includes("dateOfMonth") ||
      html.includes("mark mar row");

    if (!isJournalAvailable) return null;

    const parsed = parseJournalData(html);
    if (!parsed.subjects || parsed.subjects.length === 0) return null;

    return { html, parsed };
  };

  try {
    let result = await doRequest();

    // Сессия протухла — переавторизовываемся и повторяем запрос
    if (!result) {
      console.log("[KBP] fetchJournal: session expired, trying re-login...");
      const reloggedIn = await autoRelogin();
      if (!reloggedIn) {
        return { success: false, error: "Session expired and re-login failed" };
      }
      result = await doRequest();
    }

    if (!result) {
      return { success: false, error: "Journal not available after re-login" };
    }

    const { html, parsed } = result;

    console.log("[KBP] Saving journal data to storage");
    await storageSet(STORAGE_KEYS.JOURNAL_DATA, JSON.stringify(parsed));
    await storageSet(STORAGE_KEYS.LAST_JOURNAL_FETCH, Date.now().toString());

    const fio = parseFioFromJournalHtml(html);
    if (fio) {
      await storageSet(STORAGE_KEYS.STUDENT_FIO, fio);
    }

    return { success: true, data: parsed };
  } catch (err) {
    console.error("[KBP] Error fetching journal:", err);
    return { success: false, error: String(err) };
  }
}

// Get cached journal data
export async function getCachedJournal(): Promise<JournalData | null> {
  const cached = await storageGet(STORAGE_KEYS.JOURNAL_DATA);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

function parseJournalData(html: string): any {
  const data: any = { subjects: [], months: [], dates: [], monthColspans: [] };

  const monthRowMatch = html.match(/<tr[^>]*id="months"[^>]*>([\s\S]*?)<\/tr>/);
  if (monthRowMatch) {
    const monthMatches = monthRowMatch[1].matchAll(
      /<td[^>]*colspan="(\d+)"[^>]*>[\s\S]*?<div[^>]*title="([^"]+)"[^>]*class="nameMonth"[^>]*>([^<]+)<\/div>/g
    );
    for (const m of monthMatches) {
      data.months.push(m[3].trim());
      data.monthColspans.push(parseInt(m[1]));
    }
  }

  const dateRowMatch = html.match(/<tr[^>]*id="dateOfMonth"[^>]*>([\s\S]*?)<\/tr>/);
  if (dateRowMatch) {
    const dateMatches = dateRowMatch[1].matchAll(/<td[^>]*><div>(\d+)<\/div><\/td>/g);
    const dates: string[] = [];
    for (const m of dateMatches) dates.push(m[1]);
    data.dates = dates;
  }

  const subjectNames: Record<string, string> = {};
  const subjectRowMatches = html.matchAll(
    /<tr[^>]*class="row(\d+)"[^>]*>[\s\S]*?<div[^>]*class="pupilName"[^>]*>([\s\S]*?)<\/div>/g
  );
  for (const m of subjectRowMatches) {
    const subjectId = m[1];
    let nameContent = m[2];
    nameContent = nameContent
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1")
      .replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (nameContent) subjectNames[subjectId] = nameContent;
  }

  const gradeRowMatches = html.matchAll(/<tr[^>]*class="mark mar row(\d+)"[^>]*>([\s\S]*?)<\/tr>/g);
  for (const rowMatch of gradeRowMatches) {
    const subjectId = rowMatch[1];
    const rowContent = rowMatch[2];
    const subjectName = subjectNames[subjectId] || `Предмет ${subjectId}`;

    const gradesMatrix: Record<number, JournalMark[]> = {};
    const tdMatches = Array.from(rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g));
    for (let cellIndex = 0; cellIndex < tdMatches.length; cellIndex++) {
      const cellContent = tdMatches[cellIndex][1];
      if (cellContent.includes("border-left: 3px solid #CCC")) break;

      const divMatch = cellContent.match(/<div[^>]*data-count-mark="(\d+)"[^>]*>([\s\S]*?)<\/div>/);
      if (!divMatch) continue;
      const markCount = parseInt(divMatch[1]);
      const fullDivTag = divMatch[0];
      const divTagMatch = fullDivTag.match(/<div[^>]*>/);
      const divTag = divTagMatch ? divTagMatch[0] : "";
      const titleMatch = divTag.match(/title\s*=\s*["']([^"]*)["']/);
      const title = titleMatch ? titleMatch[1].trim() : "";
      const isAlert = /\balert_m\b/i.test(cellContent);
      const divContent = divMatch[2];

      if (markCount > 0 && cellIndex < data.dates.length) {
        const markSpans = Array.from(
          divContent.matchAll(/<span[^>]*\bclass\s*=\s*["'][^"']*\bmar\b[^"']*["'][^>]*>([^<]+)<\/span>/gi)
        );
        const cellGrades: JournalMark[] = [];
        for (const spanMatch of markSpans) {
          const gradeValue = spanMatch[1].trim();
          if (gradeValue) cellGrades.push({ value: gradeValue, type: title, kind: isAlert ? "alert" : "normal" });
        }
        if (cellGrades.length > 0) gradesMatrix[cellIndex] = cellGrades;
      }
    }

    const averageMatch = rowContent.match(
      /<td[^>]*style="border-left: 3px solid #CCC;"[^>]*><div>([^<]+)<\/div><\/td>/
    );
    const average = averageMatch ? averageMatch[1].trim() : null;

    data.subjects.push({
      id: subjectId,
      name: subjectName,
      gradesMatrix,
      average: average || "-",
    });
  }

  return data;
}

export async function fetchTimetable(groupId: string): Promise<{ success: boolean; data?: any; error?: string }> {
  console.log("[KBP] fetchTimetable called for group:", groupId);

  if (!isNativeApp()) {
    const res = await fetch("/api/timetable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    return await res.json();
  }

  try {
    // 1) get group name by id from ej login page (same mapping as web)
    const groups = await getGroups();
    const userGroup = groups.find((g) => g.id === groupId);
    if (!userGroup) return { success: false, error: `Group with ID ${groupId} not found` };

    // 2) parse timetable group id from main timetable page
    const main = await nativeRequestText({
      url: "https://kbp.by/rasp/timetable/view_beta_kbp/",
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    if (main.status === 403) {
      return { success: false, error: "KBP_403" };
    }

    const groupMap: Record<string, string> = {};
    const linkMatches = main.data.matchAll(
      /<a[^>]*href="[^"]*\?page=stable&amp;cat=group&amp;id=(\d+)"[^>]*>([^<]+)<\/a>/g
    );
    for (const m of linkMatches) {
      const timetableId = m[1];
      const groupName = m[2].trim();
      if (timetableId && groupName) groupMap[groupName] = timetableId;
    }

    const timetableId = groupMap[userGroup.name];
    if (!timetableId) return { success: false, error: `Group ${userGroup.name} not found in timetable` };

    // 3) fetch timetable page + parse
    const page = await nativeRequestText({
      url: `https://kbp.by/rasp/timetable/view_beta_kbp/?page=stable&cat=group&id=${timetableId}`,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    if (page.status === 403) {
      return { success: false, error: "KBP_403" };
    }

    const timetableData = parseTimetableHtml(page.data, timetableId, userGroup.name);

    // Save to storage before returning
    console.log("[KBP] Saving timetable data to storage");
    await storageSet(STORAGE_KEYS.TIMETABLE_DATA, JSON.stringify(timetableData));
    await storageSet(STORAGE_KEYS.LAST_TIMETABLE_FETCH, Date.now().toString());
    // URL расписания для Java BackgroundSyncWorker (нужен чтобы фоновый воркер знал куда ходить)
    await storageSet("cached_timetable_url",
      `https://kbp.by/rasp/timetable/view_beta_kbp/?page=stable&cat=group&id=${timetableId}`);

    return { success: true, data: timetableData };
  } catch (err) {
    console.error("[KBP] Error fetching timetable:", err);
    return { success: false, error: String(err) };
  }
}

// Get cached timetable data
export async function getCachedTimetable(): Promise<any | null> {
  const cached = await storageGet(STORAGE_KEYS.TIMETABLE_DATA);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

function getPairTime(pairNumber: number, dayIndex: number): { start: string; end: string } {
  return getKbpPairTime(pairNumber, dayIndex);
}

/** Парсинг HTML расписания КБП (left_week + понедельник из right_week) */
export function parseTimetableHtml(html: string, groupId: string, groupName: string): any {
  const data: any = {
    groupId,
    groupName,
    pairs: [],
    dayStartTimes: [
      { start: "", end: "" },
      { start: "", end: "" },
      { start: "", end: "" },
      { start: "", end: "" },
      { start: "", end: "" },
      { start: "", end: "" },
    ],
    dayReplacementStatus: [
      { label: "", hasChanges: false, noChanges: false, unknown: true },
      { label: "", hasChanges: false, noChanges: false, unknown: true },
      { label: "", hasChanges: false, noChanges: false, unknown: true },
      { label: "", hasChanges: false, noChanges: false, unknown: true },
      { label: "", hasChanges: false, noChanges: false, unknown: true },
      { label: "", hasChanges: false, noChanges: false, unknown: true },
    ],
  };

  const weekDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

  const extractWeekBlock = (weekId: "left_week" | "right_week"): string | null => {
    if (weekId === "left_week") {
      return html.match(/<div[^>]*id=["']left_week["'][^>]*>([\s\S]*?)<div[^>]*id=["']right_week["']/i)?.[1] ?? null;
    }
    return html.match(/<div[^>]*id=["']right_week["'][^>]*>([\s\S]*)/i)?.[1] ?? null;
  };

  const extractScheduleTable = (weekBlock: string): string | null => {
    const m = weekBlock.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    const content = m?.[1];
    return content && (content.includes("pair-number") || content.includes('day="')) ? content : null;
  };

  const parseWeekMeta = (weekBlock: string) => ({
    dateRange: weekBlock.match(/<p[^>]*class=["']date["'][^>]*>([^<]*)<\/p>/i)?.[1]?.trim() ?? "",
    weekLabel: weekBlock.match(/<p[^>]*class=["']today["'][^>]*>([^<]*)<\/p>/i)?.[1]?.trim() ?? "",
  });

  const parseZamenaForDays = (tableContent: string, dayIndices: number[]) => {
    const replacementRowMatch = tableContent.match(/<tr[^>]*class="[^"]*zamena[^"]*"[^>]*>([\s\S]*?)<\/tr>/i);
    if (!replacementRowMatch) return;
    const replacementCells = Array.from(replacementRowMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi));
    for (let i = 0; i < dayIndices.length; i++) {
      const storeIndex = dayIndices[i];
      const cellContent = replacementCells[i + 1]?.[1] || "";
      const plain = cellContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const hasChanges = /показать\s+замены/i.test(plain);
      const noChanges = /нету?\s+замен/i.test(plain);
      if (!data.dayReplacementStatus[storeIndex]) {
        data.dayReplacementStatus[storeIndex] = { label: "", hasChanges: false, noChanges: false, unknown: true };
      }
      data.dayReplacementStatus[storeIndex] = {
        label: plain,
        hasChanges,
        noChanges,
        unknown: !hasChanges && !noChanges,
      };
    }
  };

  const segments: { content: string; weekOffset: number }[] = [];
  const leftBlock = extractWeekBlock("left_week");
  const rightBlock = extractWeekBlock("right_week");

  if (leftBlock) {
    const leftTable = extractScheduleTable(leftBlock);
    if (leftTable) {
      segments.push({ content: leftTable, weekOffset: 0 });
      data.currentWeek = parseWeekMeta(leftBlock);
      parseZamenaForDays(leftTable, [0, 1, 2, 3, 4, 5]);
    }
  }

  if (rightBlock) {
    const rightTable = extractScheduleTable(rightBlock);
    if (rightTable) {
      segments.push({ content: rightTable, weekOffset: 1 });
      data.nextWeekMonday = parseWeekMeta(rightBlock);
      data.hasNextWeekMonday = true;
      data.dayStartTimes.push({ start: "", end: "" });
      data.dayReplacementStatus.push({ label: "", hasChanges: false, noChanges: false, unknown: true });
      parseZamenaForDays(rightTable, [6]);
    }
  }

  if (segments.length === 0) {
    const rwIdx = html.search(/id=["']right_week["']/i);
    const tableMatches = Array.from(html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi));
    for (const match of tableMatches) {
      const content = match[1];
      if (!content.includes("pair-number") && !content.includes('day="')) continue;
      const full = match[0];
      const globalIdx = html.indexOf(full);
      if (globalIdx < 0) continue;
      if (segments.length === 0) {
        segments.push({ content, weekOffset: 0 });
        continue;
      }
      if (rwIdx >= 0 && globalIdx > rwIdx && content !== segments[0].content) {
        segments.push({ content, weekOffset: 1 });
        data.hasNextWeekMonday = true;
        data.nextWeekMonday = data.nextWeekMonday ?? { dateRange: "", weekLabel: "след. нед." };
        data.dayStartTimes.push({ start: "", end: "" });
        data.dayReplacementStatus.push({ label: "", hasChanges: false, noChanges: false, unknown: true });
        break;
      }
    }
  }

  if (segments.length === 0) return data;

  data.hasNextWeek = Boolean(data.hasNextWeekMonday);

  for (const seg of segments) {
    const tableContent = seg.content;
    const weekOffset = seg.weekOffset;

  const rowMatches = Array.from(tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g));
  for (const rowMatch of rowMatches) {
    const rowContent = rowMatch[1];
    const pairNumberMatch = rowContent.match(/<td[^>]*class="[^"]*number[^"]*"[^>]*>(\d+)<\/td>/);
    if (!pairNumberMatch) continue;
    const pairNumber = parseInt(pairNumberMatch[1]);

    const dayCells = Array.from(rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g));
    if (dayCells.length < 8) continue;

    for (let cellIndex = 1; cellIndex < dayCells.length - 1; cellIndex++) {
      const cellContent = dayCells[cellIndex][1];
      let dayIndex: number | null = null;

      const dayCommentMatch = cellContent.match(/<!--[^>]*day="(\d+)"[^>]*-->/);
      if (dayCommentMatch) {
        const dayFromComment = parseInt(dayCommentMatch[1]);
        if (dayFromComment >= 1 && dayFromComment <= 6) dayIndex = dayFromComment - 1;
      }
      if (dayIndex === null) {
        dayIndex = cellIndex - 1;
        if (dayIndex < 0 || dayIndex > 5) continue;
      }

      // right_week: только понедельник (колонка после субботы текущей недели)
      if (weekOffset === 1 && dayIndex !== 0) continue;

      if (cellContent.includes("empty-pair") && !cellContent.includes("pair")) continue;

      let pairStartIndex = 0;
      let iterations = 0;
      while (pairStartIndex < cellContent.length && iterations < 100) {
        iterations++;
        const pairStartMatch = cellContent.substring(pairStartIndex).match(/<div[^>]*class="([^"]*)"[^>]*>/i);
        if (!pairStartMatch) break;
        const pairStartPos = pairStartIndex + (pairStartMatch.index || 0);
        const pairClasses = pairStartMatch[1] || "";
        const pairTagStart = pairStartPos + pairStartMatch[0].length;

        if (!pairClasses.includes("pair")) {
          pairStartIndex = pairTagStart + 1;
          continue;
        }

        let depth = 1;
        let pos = pairTagStart;
        let pairEndPos = -1;
        let depthIterations = 0;
        while (pos < cellContent.length && depth > 0 && depthIterations < 1000) {
          depthIterations++;
          const nextDivOpen = cellContent.indexOf("<div", pos);
          const nextDivClose = cellContent.indexOf("<\/div>", pos);
          if (nextDivClose === -1) break;
          if (nextDivOpen !== -1 && nextDivOpen < nextDivClose) {
            depth++;
            pos = nextDivOpen + 4;
          } else {
            depth--;
            if (depth === 0) {
              pairEndPos = nextDivClose;
              break;
            }
            pos = nextDivClose + 6;
          }
        }
        if (pairEndPos === -1) {
          pairStartIndex = pairTagStart + 1;
          continue;
        }

        const pairContent = cellContent.substring(pairTagStart, pairEndPos);
        if (!pairContent.trim()) {
          pairStartIndex = pairEndPos + 6;
          continue;
        }

        const pairData: any = {
          pairNumber,
          day: dayIndex,
          dayName: weekDays[dayIndex],
          subject: "",
          teacher: "",
          room: "",
          group: "",
          refs: { teachers: [] as Array<{ id: string; name: string }> },
          status: "normal",
        };

        const subjectMatch = pairContent.match(
          /<div[^>]*class="[^"]*subject[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i
        );
        if (subjectMatch) pairData.subject = subjectMatch[1].trim();
        const subjectRefMatch = pairContent.match(
          /<div[^>]*class="[^"]*subject[^"]*"[^>]*>[\s\S]*?<a[^>]*href="[^"]*\?cat=subject(?:&amp;|&)id=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/i
        );
        if (subjectRefMatch?.[1]) {
          pairData.refs.subject = { id: subjectRefMatch[1], name: subjectRefMatch[2]?.trim() || pairData.subject };
        }

        const leftColumnStartMatch = pairContent.match(/<div[^>]*class="[^"]*left-column[^"]*"[^>]*>/i);
        if (leftColumnStartMatch) {
          const leftColumnStartPos = leftColumnStartMatch.index || 0;
          const leftColumnTagStart = leftColumnStartPos + leftColumnStartMatch[0].length;
          let depth = 1;
          let pos = leftColumnTagStart;
          let leftColumnEndPos = -1;
          let depthIterations = 0;
          while (pos < pairContent.length && depth > 0 && depthIterations < 100) {
            depthIterations++;
            const nextDivOpen = pairContent.indexOf("<div", pos);
            const nextDivClose = pairContent.indexOf("<\/div>", pos);
            if (nextDivClose === -1) break;
            if (nextDivOpen !== -1 && nextDivOpen < nextDivClose) {
              depth++;
              pos = nextDivOpen + 4;
            } else {
              depth--;
              if (depth === 0) {
                leftColumnEndPos = nextDivClose;
                break;
              }
              pos = nextDivClose + 6;
            }
          }
          if (leftColumnEndPos !== -1) {
            const leftColumnContent = pairContent.substring(leftColumnTagStart, leftColumnEndPos);
            const teacherDivMatches = leftColumnContent.matchAll(
              /<div[^>]*class="[^"]*teacher[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
            );
            const teachers: string[] = [];
            for (const teacherDivMatch of teacherDivMatches) {
              const teacherDivContent = teacherDivMatch[1];
              const teacherLinkMatches = teacherDivContent.matchAll(/<a[^>]*>([^<]+)<\/a>/gi);
              for (const teacherLinkMatch of teacherLinkMatches) {
                const teacher = teacherLinkMatch[1].trim();
                if (teacher && teacher !== "&nbsp;") teachers.push(teacher);
              }
              const teacherRefMatches = teacherDivContent.matchAll(
                /<a[^>]*href="[^"]*\?cat=teacher(?:&amp;|&)id=(\d+)[^"]*"[^>]*>([^<]*)<\/a>/gi
              );
              for (const teacherRefMatch of teacherRefMatches) {
                const id = teacherRefMatch[1];
                const name = (teacherRefMatch[2] || "").trim();
                if (id && name) pairData.refs.teachers.push({ id, name });
              }
            }
            pairData.teacher = teachers.join(", ");
          }
        }

        const rightColumnStartMatch = pairContent.match(/<div[^>]*class="[^"]*right-column[^"]*"[^>]*>/i);
        if (rightColumnStartMatch) {
          const rightColumnStartPos = rightColumnStartMatch.index || 0;
          const rightColumnTagStart = rightColumnStartPos + rightColumnStartMatch[0].length;
          let depth = 1;
          let pos = rightColumnTagStart;
          let rightColumnEndPos = -1;
          let depthIterations = 0;
          while (pos < pairContent.length && depth > 0 && depthIterations < 100) {
            depthIterations++;
            const nextDivOpen = pairContent.indexOf("<div", pos);
            const nextDivClose = pairContent.indexOf("<\/div>", pos);
            if (nextDivClose === -1) break;
            if (nextDivOpen !== -1 && nextDivOpen < nextDivClose) {
              depth++;
              pos = nextDivOpen + 4;
            } else {
              depth--;
              if (depth === 0) {
                rightColumnEndPos = nextDivClose;
                break;
              }
              pos = nextDivClose + 6;
            }
          }
          if (rightColumnEndPos !== -1) {
            const rightColumnContent = pairContent.substring(rightColumnTagStart, rightColumnEndPos);
            const placeDivMatch = rightColumnContent.match(/<div[^>]*class="[^"]*place[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            if (placeDivMatch) {
              const placeDivContent = placeDivMatch[1];
              const placeLinkMatches = placeDivContent.matchAll(/<a[^>]*>([^<]+)<\/a>/gi);
              for (const placeLinkMatch of placeLinkMatches) {
                const room = placeLinkMatch[1].trim();
                if (room && room !== "&nbsp;") {
                  pairData.room = room;
                  break;
                }
              }
              const placeRefMatch = placeDivContent.match(
                /<a[^>]*href="[^"]*\?cat=place(?:&amp;|&)id=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/i
              );
              if (placeRefMatch?.[1]) {
                pairData.refs.place = { id: placeRefMatch[1], name: placeRefMatch[2]?.trim() || pairData.room };
              }
            }
            const groupDivMatch = rightColumnContent.match(/<div[^>]*class="[^"]*group[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            if (groupDivMatch) {
              const groupDivContent = groupDivMatch[1];
              const groupNameMatch = groupDivContent.match(/<a[^>]*>([^<]+)<\/a>/i);
              if (groupNameMatch?.[1]) pairData.group = groupNameMatch[1].trim();
              const groupRefMatch = groupDivContent.match(
                /<a[^>]*href="[^"]*\?cat=group(?:&amp;|&)id=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/i
              );
              if (groupRefMatch?.[1]) {
                pairData.refs.group = { id: groupRefMatch[1], name: groupRefMatch[2]?.trim() || pairData.group };
              }
            }
          }
        }

        if (pairClasses.includes("added")) pairData.status = "added";
        else if (pairClasses.includes("replaced")) pairData.status = "replaced";
        else if (pairClasses.includes("removed")) pairData.status = "removed";
        else if (pairClasses.includes("cancelled")) pairData.status = "cancelled";

        if (pairData.subject) {
          pairData.weekOffset = weekOffset;
          if (weekOffset === 1) pairData.isNextWeekMonday = true;
          data.pairs.push(pairData);
        }
        pairStartIndex = pairEndPos + 6;
      }
    }
  }

  }

  const fillDayRange = (dayIndex: number, filter: (p: any) => boolean) => {
    const dayPairs = data.pairs.filter(filter);
    if (dayPairs.length === 0) return;
    const firstPair = dayPairs.reduce((min: any, p: any) => (p.pairNumber < min.pairNumber ? p : min), dayPairs[0]);
    const lastPair = dayPairs.reduce((max: any, p: any) => (p.pairNumber > max.pairNumber ? p : max), dayPairs[0]);
    const firstTime = getPairTime(firstPair.pairNumber, dayIndex === 6 ? 0 : dayIndex);
    const lastTime = getPairTime(lastPair.pairNumber, dayIndex === 6 ? 0 : dayIndex);
    data.dayStartTimes[dayIndex] = { start: firstTime.start, end: lastTime.end };
  };

  for (let dayIndex = 0; dayIndex < 6; dayIndex++) {
    fillDayRange(dayIndex, (p: any) => {
      if ((p.weekOffset ?? 0) !== 0) return false;
      if (p.day !== dayIndex) return false;
      const subjectTrimmed = (p.subject || "").trim();
      if (!subjectTrimmed || subjectTrimmed === "Урок снят") return false;
      if (p.status === "removed" || p.status === "cancelled") return false;
      return p.status === "added" || p.status === "normal" || p.status === "replaced" || !p.status;
    });
  }

  if (data.hasNextWeekMonday) {
    fillDayRange(6, (p: any) => {
      if ((p.weekOffset ?? 0) !== 1 || p.day !== 0) return false;
      const subjectTrimmed = (p.subject || "").trim();
      if (!subjectTrimmed || subjectTrimmed === "Урок снят") return false;
      if (p.status === "removed" || p.status === "cancelled") return false;
      return p.status === "added" || p.status === "normal" || p.status === "replaced" || !p.status;
    });
  }

  return data;
}