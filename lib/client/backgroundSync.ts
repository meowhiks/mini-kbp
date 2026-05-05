import { fetchJournal, fetchTimetable, type JournalData } from "./kbpApi";
import { fetchTimetableByCategory } from "./searchApi";
import type { SearchResult } from "./searchApi";
import { storageGet, storageSet } from "./storage";
import { scheduleLocalNotification, startBackgroundSync as startNativeBackgroundSync } from "./notifications";

let syncStarted = false;

interface ChangeDetection {
  type: "grade" | "timetable";
  subject?: string;
  date?: string;
  oldValue?: string;
  newValue?: string;
  message: string;
}

// Compare two journal data objects to find changes
function detectJournalChanges(oldData: JournalData, newData: JournalData): ChangeDetection[] {
  const changes: ChangeDetection[] = [];

  if (!oldData?.subjects || !newData?.subjects) return changes;

  // Build map of old grades by subject and date index
  const oldGradesMap = new Map<string, Map<number, Array<{ value: string; type: string }>>>();
  for (const subject of oldData.subjects) {
    const dateMap = new Map<number, Array<{ value: string; type: string }>>();
    if (subject.gradesMatrix) {
      for (const [dateIdx, grades] of Object.entries(subject.gradesMatrix)) {
        dateMap.set(parseInt(dateIdx), grades as any);
      }
    }
    oldGradesMap.set(subject.name, dateMap);
  }

  // Compare with new data
  for (const newSubject of newData.subjects) {
    const oldSubjectMap = oldGradesMap.get(newSubject.name);
    if (!oldSubjectMap) {
      // New subject appeared (unlikely but possible)
      changes.push({
        type: "grade",
        subject: newSubject.name,
        message: `Новый предмет: ${newSubject.name}`,
      });
      continue;
    }

    if (newSubject.gradesMatrix) {
      for (const [dateIdxStr, newGrades] of Object.entries(newSubject.gradesMatrix)) {
        const dateIdx = parseInt(dateIdxStr);
        const oldGrades = oldSubjectMap.get(dateIdx);

        if (!oldGrades) {
          // New grades for this date
          const gradesList = (newGrades as any[]).map((g: any) => g.value).join(", ");
          const date = newData.dates?.[dateIdx] || "?";
          const month = getMonthForDate(newData, dateIdx);
          changes.push({
            type: "grade",
            subject: newSubject.name,
            date: `${date} ${month}`,
            newValue: gradesList,
            message: `Новая оценка: ${newSubject.name} — ${gradesList} (${date} ${month})`,
          });
        } else if (oldGrades.length !== (newGrades as any[]).length) {
          // Number of grades changed
          const oldList = oldGrades.map((g: any) => g.value).join(", ");
          const newList = (newGrades as any[]).map((g: any) => g.value).join(", ");
          const date = newData.dates?.[dateIdx] || "?";
          const month = getMonthForDate(newData, dateIdx);
          changes.push({
            type: "grade",
            subject: newSubject.name,
            date: `${date} ${month}`,
            oldValue: oldList,
            newValue: newList,
            message: `Изменение оценки: ${newSubject.name} — было ${oldList}, стало ${newList} (${date} ${month})`,
          });
        }
      }
    }
  }

  return changes;
}

function getMonthForDate(data: JournalData, dateIdx: number): string {
  if (!data.months || !data.monthColspans) return "";

  let currentPos = 0;
  for (let i = 0; i < data.monthColspans.length; i++) {
    const colspan = data.monthColspans[i];
    if (dateIdx >= currentPos && dateIdx < currentPos + colspan) {
      return data.months[i] || "";
    }
    currentPos += colspan;
  }
  return "";
}

// Compare timetable data
function detectTimetableChanges(oldData: any, newData: any): ChangeDetection[] {
  const changes: ChangeDetection[] = [];

  if (!oldData?.pairs || !newData?.pairs) return changes;

  // Check for new or changed pairs
  const oldPairsMap = new Map<string, any>();
  for (const pair of oldData.pairs) {
    const key = `${pair.day}-${pair.pairNumber}`;
    oldPairsMap.set(key, pair);
  }

  for (const newPair of newData.pairs) {
    const key = `${newPair.day}-${newPair.pairNumber}`;
    const oldPair = oldPairsMap.get(key);

    if (!oldPair) {
      // New pair
      const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
      changes.push({
        type: "timetable",
        subject: newPair.subject,
        message: `Новая пара: ${newPair.subject} (${dayNames[newPair.day]})`,
      });
    } else if (oldPair.status !== newPair.status) {
      // Status changed
      const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
      const statusText = newPair.status === "added" ? "добавлена" : newPair.status === "removed" ? "снята" : "изменена";
      changes.push({
        type: "timetable",
        subject: newPair.subject,
        message: `Изменение в расписании: ${newPair.subject} ${statusText} (${dayNames[newPair.day]})`,
      });
    }
  }

  return changes;
}

function parseStoredTimetableSelection(raw: string | null): SearchResult | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SearchResult>;
    if (!o?.id || !o?.type) return null;
    if (o.type !== "group" && o.type !== "teacher" && o.type !== "place" && o.type !== "subject") return null;
    return { id: String(o.id), name: String(o.name || ""), type: o.type, typeLabel: String(o.typeLabel || "") };
  } catch {
    return null;
  }
}

async function fetchTimetableForBackground(groupId: string | null, selectedRaw: string | null) {
  const selected = parseStoredTimetableSelection(selectedRaw);
  if (selected?.id && selected.type) {
    return fetchTimetableByCategory(selected.type, selected.id);
  }
  if (groupId) return fetchTimetable(groupId);
  return Promise.resolve({ success: false as const });
}

// Main background sync function
export async function performBackgroundSync(): Promise<boolean> {
  console.log("[BackgroundSync] Starting sync...");

  try {
    // Get saved data for comparison
    const [savedJournal, savedTimetable, groupId, selectedTimetableRaw, appSettingsRaw] = await Promise.all([
      storageGet("cached_journal_data"),
      storageGet("cached_timetable_data"),
      storageGet("ej_group_id"),
      storageGet("cached_selected_timetable_result"),
      storageGet("app_settings_v1"),
    ]);
    const settings = appSettingsRaw ? JSON.parse(appSettingsRaw) : {};
    const notificationsEnabled = Boolean(settings?.notificationsEnabled);
    const notifyJournal = settings?.notifyJournal !== false;
    const notifyTimetable = settings?.notifyTimetable !== false;

    const oldJournal = savedJournal ? JSON.parse(savedJournal) : null;
    const oldTimetable = savedTimetable ? JSON.parse(savedTimetable) : null;

    // Fetch журнал и расписание параллельно (расписание — по выбранной сущности или группе из журнала)
    const [journalResult, timetableResult] = await Promise.all([
      fetchJournal(),
      fetchTimetableForBackground(groupId, selectedTimetableRaw),
    ]);

    const changes: ChangeDetection[] = [];

    // Detect journal changes
    if (journalResult.success && journalResult.data) {
      await storageSet("cached_journal_data", JSON.stringify(journalResult.data));

      if (oldJournal) {
        const journalChanges = detectJournalChanges(oldJournal, journalResult.data);
        changes.push(...journalChanges);
      }
    }

    // Detect timetable changes
    if (timetableResult.success && 'data' in timetableResult && timetableResult.data) {
      await storageSet("cached_timetable_data", JSON.stringify(timetableResult.data));

      if (oldTimetable) {
        const timetableChanges = detectTimetableChanges(oldTimetable, timetableResult.data);
        changes.push(...timetableChanges);
      }
    }

    // Send notifications for changes
    if (changes.length > 0) {
      console.log("[BackgroundSync] Detected", changes.length, "changes");

      // Show notification for each change (limit to 3)
      const filteredChanges = changes
        .filter((change) => {
          if (!notificationsEnabled) return false;
          if (change.type === "grade") return notifyJournal;
          if (change.type === "timetable") return notifyTimetable;
          return false;
        });
      const changesToShow = filteredChanges.slice(0, 3);
      for (const change of changesToShow) {
        const isTimetable = change.type === "timetable";
        await scheduleLocalNotification(
          isTimetable ? "Обновление расписания" : "Обновление журнала",
          change.message,
          Date.now() + Math.random() * 1000,
          isTimetable ? "timetable" : "journal"
        );
      }

      // If more changes, show summary
      if (filteredChanges.length > 3) {
        await scheduleLocalNotification(
          "Обновления",
          `И еще ${filteredChanges.length - 3} изменений`,
          Date.now() + 100,
          "journal"
        );
      }
    } else {
      console.log("[BackgroundSync] No changes detected");
    }

    // Save last sync time
    await storageSet("last_sync_time", Date.now().toString());

    return true;
  } catch (err) {
    console.error("[BackgroundSync] Failed:", err);
    return false;
  }
}

// Check if sync is needed (раз в час)
export async function shouldPerformSync(): Promise<boolean> {
  const lastSync = await storageGet("last_sync_time");
  if (!lastSync) return true;

  const lastSyncTime = parseInt(lastSync);
  const oneHour = 60 * 60 * 1000;
  const timeSinceLastSync = Date.now() - lastSyncTime;

  console.log("[BackgroundSync] Time since last sync:", Math.round(timeSinceLastSync / 1000 / 60), "minutes");

  return timeSinceLastSync >= oneHour;
}

// Setup periodic sync
export async function setupBackgroundSync() {
  if (syncStarted) return;
  syncStarted = true;

  // Check on app startup
  if (await shouldPerformSync()) {
    await performBackgroundSync();
  }

  setInterval(async () => {
    if (await shouldPerformSync()) {
      await performBackgroundSync();
    }
  }, 60 * 60 * 1000);

  // Start native background sync for when app is closed
  // This will use WorkManager to periodically check for updates
  const settings = await storageGet("app_settings_v1");
  const parsedSettings = settings ? JSON.parse(settings) : {};
  const notificationsEnabled = Boolean(parsedSettings?.notificationsEnabled);

  if (notificationsEnabled) {
    // Start with 60 minute interval (WorkManager will use minimum 15 minutes)
    await startNativeBackgroundSync(60);
    console.log("[BackgroundSync] Native background sync started");
  }

  console.log("[BackgroundSync] Setup complete");
}
