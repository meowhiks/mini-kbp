"use client";

import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { themeAppShell, themeIsDark, themePageBg, type AppTheme } from "@/lib/client/appTheme";
import TimetableSearchCompact from "./components/TimetableSearchCompact";
import TimetableView from "./components/TimetableView";
import LoadingScreen from "./components/LoadingScreen";
import {
  getGroups,
  login,
  fetchJournal,
  fetchTimetable,
  fetchStudentFIO,
  getCachedFIO,
  journalDataNeedsKindRefresh,
  journalMarkAlertStyle,
  type Group,
} from "@/lib/client/kbpApi";
import { normalizeTimetableData } from "@/lib/client/timetableDisplay";
import {
  calcSubjectAverageFromMarks,
  calcTotalAverageFromSubjects,
  formatComputedAverage,
} from "@/lib/client/journalAverage";
import { fetchTimetableByCategory, listTimetableEntities, type SearchResult } from "@/lib/client/searchApi";
import { storageGet, storageRemove, storageSet } from "@/lib/client/storage";
import { requestNotificationPermissions, scheduleQuickSyncOnClose } from "@/lib/client/notifications";
import { performBackgroundSync, setupBackgroundSync, shouldPerformSync } from "@/lib/client/backgroundSync";
type LoginHistoryItem = {
  id: string;
  surname: string;
  date: string;
  group: string;
  groupName: string;
  at: number;
};

function loginHistoryKey(item: { surname: string; date: string; group: string }): string {
  return `${item.surname.trim().toLowerCase()}|${item.date}|${item.group}`;
}

function dedupeLoginHistory(items: LoginHistoryItem[]): LoginHistoryItem[] {
  const byKey = new Map<string, LoginHistoryItem>();
  for (const it of items) {
    const key = loginHistoryKey(it);
    const prev = byKey.get(key);
    if (!prev || it.at > prev.at) {
      byKey.set(key, { ...it, id: key });
    }
  }
  return [...byKey.values()].sort((a, b) => b.at - a.at);
}

type JournalEntry = {
  id: string;
  surname: string;
  groupId: string;
  groupName: string;
  data: any;
};

function normalizeDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const p1 = digits.slice(0, 2);
  const p2 = digits.slice(2, 4);
  const p3 = digits.slice(4, 8);
  if (digits.length <= 2) return p1;
  if (digits.length <= 4) return `${p1}.${p2}`;
  return `${p1}.${p2}.${p3}`;
}

function isValidDateFormat(value: string): boolean {
  return /^\d{2}\.\d{2}\.\d{4}$/.test(value);
}

function normalizeEntityName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,_()\-]/g, "")
    .trim();
}

export default function MainPage() {
  const [currentPage, setCurrentPage] = useState(1); // 0: Settings, 1: Timetable, 2: Journal

  // App settings
  const [theme, setTheme] = useState<AppTheme>("light");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notifyJournal, setNotifyJournal] = useState(true);
  const [notifyTimetable, setNotifyTimetable] = useState(true);
  const [countdownToLesson, setCountdownToLesson] = useState(false);
  const [showReplacementsByDefault, setShowReplacementsByDefault] = useState(true);
  const [timetableDensity, setTimetableDensity] = useState<"normal" | "compact" | "small">("normal");
  const [journalShowAverage, setJournalShowAverage] = useState(true);
  const [journalDenseCells, setJournalDenseCells] = useState(false);
  const [journalShowHundredths, setJournalShowHundredths] = useState(false);
  const [journalShowTotal, setJournalShowTotal] = useState(true);
  const [timetableHideTeacherRoom, setTimetableHideTeacherRoom] = useState(false);
  const [timetableHidePairNumbers, setTimetableHidePairNumbers] = useState(false);
  const [timetableDayStrip, setTimetableDayStrip] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const isDark = themeIsDark(theme);

  // Login states
  const [surname, setSurname] = useState("");
  const [date, setDate] = useState("");
  const [group, setGroup] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupsNotice, setGroupsNotice] = useState("");
  const [error, setError] = useState("");
  const [kbpNotice, setKbpNotice] = useState("");
  const [checkingSavedData, setCheckingSavedData] = useState(true);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryItem[]>([]);

  // Journal states
  const [journalData, setJournalData] = useState<any>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [studentFio, setStudentFio] = useState("");

  // Timetable states
  const [selectedTimetable, setSelectedTimetable] = useState<any>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [isRefreshingTimetable, setIsRefreshingTimetable] = useState(false);
  const [isRefreshingJournal, setIsRefreshingJournal] = useState(false);

  // Check saved login data
  useEffect(() => {
    const checkSavedData = async () => {
      if (Capacitor.isNativePlatform()) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      try {
        const [
          savedLoginData,
          savedJournal,
          savedTimetable,
          savedSelectedResult,
          savedGroupId,
          savedSettings,
          savedLoginForm,
          savedLoginHistory,
          savedJournalEntries,
        ] = await Promise.all([
          storageGet("ej_login_data"),
          storageGet("cached_journal_data"),
          storageGet("cached_timetable_data"),
          storageGet("cached_selected_timetable_result"),
          storageGet("ej_group_id"),
          storageGet("app_settings_v1"),
          storageGet("journal_login_form_v1"),
          storageGet("journal_login_history_v1"),
          storageGet("cached_journal_entries_v1"),
        ]);

        if (savedSettings) {
          try {
            const s = JSON.parse(savedSettings);
            if (s?.isDark || s?.theme === "light" || s?.theme === "oled") setTheme(s.theme);
            if (typeof s?.notificationsEnabled === "boolean") setNotificationsEnabled(s.notificationsEnabled);
            if (typeof s?.notifyJournal === "boolean") setNotifyJournal(s.notifyJournal);
            if (typeof s?.notifyTimetable === "boolean") setNotifyTimetable(s.notifyTimetable);
            if (typeof s?.countdownToLesson === "boolean") setCountdownToLesson(s.countdownToLesson);
            if (typeof s?.showReplacementsByDefault === "boolean") setShowReplacementsByDefault(s.showReplacementsByDefault);
            if (s?.timetableDensity === "normal" || s?.timetableDensity === "compact" || s?.timetableDensity === "small") {
              setTimetableDensity(s.timetableDensity);
            }
            if (typeof s?.journalShowAverage === "boolean") setJournalShowAverage(s.journalShowAverage);
            if (typeof s?.journalDenseCells === "boolean") setJournalDenseCells(s.journalDenseCells);
            if (typeof s?.journalShowHundredths === "boolean") setJournalShowHundredths(s.journalShowHundredths);
            if (typeof s?.journalShowTotal === "boolean") setJournalShowTotal(s.journalShowTotal);
            if (typeof s?.timetableHideTeacherRoom === "boolean") setTimetableHideTeacherRoom(s.timetableHideTeacherRoom);
            if (typeof s?.timetableHidePairNumbers === "boolean") setTimetableHidePairNumbers(s.timetableHidePairNumbers);
            if (typeof s?.timetableDayStrip === "boolean") setTimetableDayStrip(s.timetableDayStrip);
          } catch {}
        }

        if (savedTimetable) {
          try {
            setSelectedTimetable(normalizeTimetableData(JSON.parse(savedTimetable)));
          } catch {}
        }
        if (savedSelectedResult) {
          try {
            setSelectedResult(JSON.parse(savedSelectedResult));
          } catch {}
        }
        if (savedLoginForm) {
          try {
            const parsed = JSON.parse(savedLoginForm);
            if (typeof parsed?.surname === "string") setSurname(parsed.surname);
            if (typeof parsed?.date === "string") setDate(parsed.date);
            if (typeof parsed?.group === "string") setGroup(parsed.group);
          } catch {}
        }
        if (savedLoginHistory) {
          try {
            const parsed = JSON.parse(savedLoginHistory);
            if (Array.isArray(parsed)) {
              setLoginHistory(
                dedupeLoginHistory(
                  parsed.filter((it) => it?.surname && it?.date && it?.group) as LoginHistoryItem[]
                )
              );
            }
          } catch {}
        }
        if (savedJournalEntries) {
          try {
            const parsed = JSON.parse(savedJournalEntries);
            if (Array.isArray(parsed)) {
              setJournalEntries(parsed.filter((it) => it?.id && it?.data));
            }
          } catch {}
        }

        const cachedFio = await getCachedFIO();
        if (cachedFio) setStudentFio(cachedFio);

        if (savedLoginData) {
          setIsLoggedIn(true);
          if (savedJournal) {
            const parsedJournal = JSON.parse(savedJournal);
            if (!journalDataNeedsKindRefresh(parsedJournal)) {
              setJournalData(parsedJournal);
            }
            if (!savedJournalEntries) {
              try {
                const loginParsed = JSON.parse(savedLoginData);
                const groupId = String(loginParsed?.group_id || "");
                const groupName = groups.find((g) => g.id === groupId)?.name || groupId;
                const surnameFromSaved = String(loginParsed?.student_name || surname || "");
                setJournalEntries([
                  {
                    id: "restored-main",
                    surname: surnameFromSaved,
                    groupId,
                    groupName,
                    data: parsedJournal,
                  },
                ]);
              } catch {}
            }
          }
          if (!savedTimetable && savedGroupId) {
            // No cached timetable yet -> fetch automatically
            const tr = await fetchTimetable(savedGroupId);
            if (tr.success && tr.data) setSelectedTimetable(normalizeTimetableData(tr.data));
          }
        }
      } catch (err) {
        console.error("Error checking saved data:", err);
      } finally {
        setSettingsHydrated(true);
        setCheckingSavedData(false);
      }
    };

    checkSavedData();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme !== "light");
    document.documentElement.classList.toggle("theme-oled", theme === "oled");
    if (settingsHydrated) {
      storageSet(
        "app_settings_v1",
        JSON.stringify({
          theme,
          notificationsEnabled,
          notifyJournal,
          notifyTimetable,
          countdownToLesson,
          showReplacementsByDefault,
          timetableDensity,
          journalShowAverage,
          journalDenseCells,
          journalShowHundredths,
          journalShowTotal,
          timetableHideTeacherRoom,
          timetableHidePairNumbers,
          timetableDayStrip,
        })
      );
    }
  }, [
    theme,
    notificationsEnabled,
    notifyJournal,
    notifyTimetable,
    countdownToLesson,
    showReplacementsByDefault,
    timetableDensity,
    journalShowAverage,
    journalDenseCells,
    journalShowHundredths,
    journalShowTotal,
    timetableHideTeacherRoom,
    timetableHidePairNumbers,
    timetableDayStrip,
    settingsHydrated,
  ]);

  useEffect(() => {
    if (checkingSavedData) return;
    storageSet("journal_login_form_v1", JSON.stringify({ surname, date, group }));
  }, [surname, date, group, checkingSavedData]);

  useEffect(() => {
    if (!group) return;
    const g = groups.find((x) => x.id === group);
    if (g && !groupSearch) setGroupSearch(g.name);
  }, [group, groups, groupSearch]);

  useEffect(() => {
    if (checkingSavedData) return;
    storageSet("journal_login_history_v1", JSON.stringify(loginHistory));
  }, [loginHistory, checkingSavedData]);

  useEffect(() => {
    if (checkingSavedData) return;
    storageSet("cached_journal_entries_v1", JSON.stringify(journalEntries));
  }, [journalEntries, checkingSavedData]);

  // Fetch groups
  useEffect(() => {
    const fetchGroupsData = async () => {
      try {
        const list = await getGroups();
        setGroups(list || []);
        if (!list || list.length === 0) {
          setGroupsNotice("Список групп временно недоступен. Попробуйте обновить чуть позже.");
        } else {
          setGroupsNotice("");
        }
      } catch (err) {
        console.error("Error fetching groups:", err);
        const message = String(err);
        if (message.includes("KBP_403")) {
          setGroupsNotice("Ошибка со стороны kbp.by (403). Используем локальные данные, если они есть.");
          setKbpNotice("Ошибка со стороны kbp.by (403). Показаны локальные данные.");
        } else {
          setGroupsNotice("Не удалось получить группы. Используем локальные данные, если они есть.");
        }
      } finally {
        setLoadingGroups(false);
      }
    };
    fetchGroupsData();
  }, []);

  const handleLogout = async () => {
    await Promise.all([
      storageRemove("ej_login_data"),
      storageRemove("ej_group_id"),
      storageRemove("cached_journal_data"),
      storageRemove("cached_student_fio"),
    ]);
    setIsLoggedIn(false);
    setJournalData(null);
  };

  const handleRemoveJournalEntry = async (entryId: string) => {
    setJournalEntries((prev) => {
      const next = prev.filter((x) => x.id !== entryId);
      if (next.length === 0) {
        setIsLoggedIn(false);
        setJournalData(null);
      }
      return next;
    });
  };

  type ClearAppDataOptions = {
    clearCache: boolean;
    clearLoginHistory: boolean;
    clearTimetables: boolean;
  };

  const handleClearAppData = async (opts: ClearAppDataOptions) => {
    try {
      await Promise.all([
        opts.clearCache
          ? Promise.all([
              storageRemove("cached_journal_data"),
              storageRemove("cached_journal_entries_v1"),
              storageRemove("cached_student_fio"),
            ])
          : Promise.resolve(),
        opts.clearLoginHistory
          ? Promise.all([
              storageRemove("journal_login_history_v1"),
              storageRemove("journal_login_form_v1"),
            ])
          : Promise.resolve(),
        opts.clearTimetables
          ? Promise.all([storageRemove("cached_timetable_data"), storageRemove("cached_selected_timetable_result")])
          : Promise.resolve(),
      ]);
    } finally {
      if (opts.clearCache) {
        setIsLoggedIn(false);
        setJournalData(null);
        setJournalEntries([]);
        setStudentFio("");
      }
      if (opts.clearLoginHistory) {
        setLoginHistory([]);
        setSurname("");
        setDate("");
        setGroup("");
        setGroupSearch("");
      }
      if (opts.clearTimetables) {
        setSelectedTimetable(null);
        setSelectedResult(null);
        setKbpNotice("");
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!group) {
      setError("Пожалуйста, выберите группу");
      setLoading(false);
      return;
    }

    try {
      const formattedDate = normalizeDateInput(date);
      if (!isValidDateFormat(formattedDate)) {
        setError("Дата должна быть в формате ДД.ММ.ГГГГ");
        setLoading(false);
        return;
      }
      const result = await login({
        student_name: surname,
        group_id: group,
        birth_day: formattedDate,
      });

      if (result.success) {
        const loginData = { student_name: surname, group_id: group, birth_day: formattedDate };
        await storageSet("ej_login_data", JSON.stringify(loginData));
        await storageSet("ej_group_id", group);

        const [journalResult, timetableResult, fioResult] = await Promise.all([
          fetchJournal(),
          fetchTimetable(group),
          fetchStudentFIO(),
        ]);

        if (journalResult.success && journalResult.data) {
          await storageSet("cached_journal_data", JSON.stringify(journalResult.data));
          setJournalData(journalResult.data);
          const fioFromCache = await getCachedFIO();
          if (fioFromCache) setStudentFio(fioFromCache);
          const groupNameForEntry = groups.find((g) => g.id === group)?.name || group;
          setJournalEntries((prev) => [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              surname,
              groupId: group,
              groupName: groupNameForEntry,
              data: journalResult.data,
            },
            ...prev,
          ]);
        }
        if (timetableResult.success && timetableResult.data) {
          setSelectedTimetable(normalizeTimetableData(timetableResult.data));
          const groupName = groups.find((g) => g.id === group)?.name || `Группа ${group}`;
          const selected = { id: group, name: groupName, type: "group", typeLabel: "" } as SearchResult;
          setSelectedResult(selected);
          await storageSet("cached_timetable_data", JSON.stringify(normalizeTimetableData(timetableResult.data)));
          await storageSet("cached_selected_timetable_result", JSON.stringify(selected));
          setKbpNotice("");
        } else if (String(timetableResult.error || "").includes("KBP_403")) {
          setKbpNotice("Ошибка со стороны kbp.by (403). Показаны локальные данные.");
        }
        if (fioResult.success && fioResult.fio) {
          setStudentFio(fioResult.fio);
        }

        const groupName = groups.find((g) => g.id === group)?.name || group;
        const historyEntry = {
          surname,
          date: formattedDate,
          group,
          groupName,
        };
        const historyKey = loginHistoryKey(historyEntry);
        setLoginHistory((prev) => [
          { id: historyKey, ...historyEntry, at: Date.now() },
          ...prev.filter((x) => loginHistoryKey(x) !== historyKey),
        ]);

        if (!journalResult.success) {
          setError(journalResult.error || "Не удалось загрузить журнал");
          return;
        }

        setIsLoggedIn(true);
        setCurrentPage(2); // Go to journal
      } else {
        setError(result.error || "Ошибка входа. Проверьте данные.");
      }
    } catch (err) {
      setError("Произошла ошибка при входе");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleTimetableSelect = (result: SearchResult, data: any) => {
    setSelectedResult(result);
    setSelectedTimetable(normalizeTimetableData(data));
    storageSet("cached_timetable_data", JSON.stringify(normalizeTimetableData(data)));
    storageSet("cached_selected_timetable_result", JSON.stringify(result));
  };

  const handleTimetableEntityNavigate = async (
    type: "group" | "teacher" | "place" | "subject",
    id: string,
    name: string
  ) => {
    let resolvedId = id;
    const resolvedName = (name || "").trim();
    if (!resolvedId && resolvedName) {
      const items = await listTimetableEntities();
      const target = normalizeEntityName(resolvedName);
      const exact = items.find((it) => it.type === type && normalizeEntityName(it.name) === target);
      const starts = !exact
        ? items.find((it) => it.type === type && normalizeEntityName(it.name).startsWith(target))
        : null;
      resolvedId = (exact || starts)?.id || "";
    }
    if (!resolvedId) return;

    const result: SearchResult = {
      id: resolvedId,
      name: resolvedName,
      type,
      typeLabel: "",
    };
    const timetableResult = await fetchTimetableByCategory(type, resolvedId);
    if (timetableResult.success && timetableResult.data) {
      setSelectedResult(result);
      setSelectedTimetable(normalizeTimetableData(timetableResult.data));
      await storageSet("cached_timetable_data", JSON.stringify(timetableResult.data));
      await storageSet("cached_selected_timetable_result", JSON.stringify(result));
      setCurrentPage(1);
    }
  };

  // Timetable refresh on startup/interval for last selected entity
  useEffect(() => {
    let cancelled = false;

    const refreshTimetable = async () => {
      try {
        setIsRefreshingTimetable(true);
        let timetableResult: { success: boolean; data?: any; error?: string } = { success: false };
        if (selectedResult?.id && selectedResult?.type) {
          timetableResult = await fetchTimetableByCategory(selectedResult.type, selectedResult.id);
        } else {
          const savedGroupId = await storageGet("ej_group_id");
          if (savedGroupId) timetableResult = await fetchTimetable(savedGroupId);
        }

        if (cancelled) return;

        if (timetableResult.success && timetableResult.data) {
          setSelectedTimetable(normalizeTimetableData(timetableResult.data));
          await storageSet("cached_timetable_data", JSON.stringify(normalizeTimetableData(timetableResult.data)));
          setKbpNotice("");
        } else if (String(timetableResult.error || "").includes("KBP_403")) {
          setKbpNotice("Ошибка со стороны kbp.by (403). Показаны локальные данные.");
        }
      } catch (err) {
        console.error("Background refresh error:", err);
      } finally {
        if (!cancelled) setIsRefreshingTimetable(false);
      }
    };

    refreshTimetable();
    const interval = setInterval(refreshTimetable, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedResult?.id, selectedResult?.type]);

  // Journal refresh on startup/interval when logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;

    const refreshJournal = async () => {
      try {
        setIsRefreshingJournal(true);
        const [journalResult, fioResult] = await Promise.all([fetchJournal(), fetchStudentFIO()]);
        if (cancelled) return;

        if (journalResult.success && journalResult.data) {
          setJournalData(journalResult.data);
          await storageSet("cached_journal_data", JSON.stringify(journalResult.data));

          // Keep the first (current) journal card in sync
          setJournalEntries((prev) => {
            if (!prev.length) return prev;
            const [first, ...rest] = prev;
            return [{ ...first, data: journalResult.data }, ...rest];
          });

          const fioFromCache = await getCachedFIO();
          if (fioFromCache) setStudentFio(fioFromCache);
        }
        if (fioResult.success && fioResult.fio) {
          setStudentFio(fioResult.fio);
        }
      } catch (err) {
        console.error("Journal refresh error:", err);
      } finally {
        if (!cancelled) setIsRefreshingJournal(false);
      }
    };

    refreshJournal();
    const interval = setInterval(refreshJournal, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLoggedIn]);

  // Refresh timetable + journal when app becomes visible again after long background
  useEffect(() => {
    if (!isLoggedIn) return;

    let lastHiddenAt = Date.now();
    let cancelled = false;

    const refreshNow = async () => {
      try {
        setIsRefreshingTimetable(true);
        setIsRefreshingJournal(true);

        // Timetable
        let timetableResult: { success: boolean; data?: any; error?: string } = { success: false };
        if (selectedResult?.id && selectedResult?.type) {
          timetableResult = await fetchTimetableByCategory(selectedResult.type, selectedResult.id);
        } else {
          const savedGroupId = await storageGet("ej_group_id");
          if (savedGroupId) timetableResult = await fetchTimetable(savedGroupId);
        }

        if (cancelled) return;
        if (timetableResult.success && timetableResult.data) {
          setSelectedTimetable(normalizeTimetableData(timetableResult.data));
          await storageSet("cached_timetable_data", JSON.stringify(normalizeTimetableData(timetableResult.data)));
          setKbpNotice("");
        }

        // Journal
        const [journalResult] = await Promise.all([fetchJournal(), fetchStudentFIO()]);
        if (cancelled) return;
        if (journalResult.success && journalResult.data) {
          setJournalData(journalResult.data);
          await storageSet("cached_journal_data", JSON.stringify(journalResult.data));

          // Update the "current" journal card (we assume it's the first entry)
          setJournalEntries((prev) => {
            if (!prev.length) return prev;
            const [first, ...rest] = prev;
            return [{ ...first, data: journalResult.data }, ...rest];
          });
        }
      } catch (err) {
        console.error("Refresh on visibility error:", err);
      } finally {
        if (!cancelled) {
          setIsRefreshingTimetable(false);
          setIsRefreshingJournal(false);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAt = Date.now();
        return;
      }

      const deltaMs = Date.now() - lastHiddenAt;
      if (deltaMs >= 30 * 60 * 1000) {
        refreshNow();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    // Refresh right away on app open/return
    refreshNow();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isLoggedIn, selectedResult?.id, selectedResult?.type]);

  useEffect(() => {
    if (!notificationsEnabled) return;
    let cancelled = false;
    (async () => {
      const granted = await requestNotificationPermissions();
      if (!granted || cancelled) return;
      await setupBackgroundSync();
      if (await shouldPerformSync()) {
        await performBackgroundSync();
      }
    })();

    const onVisible = async () => {
      if (document.visibilityState === "hidden") {
        if (Capacitor.isNativePlatform() && notificationsEnabled) {
          await scheduleQuickSyncOnClose(15);
        }
        return;
      }
      if (document.visibilityState !== "visible") return;
      const granted = await requestNotificationPermissions();
      if (!granted || cancelled) return;
      if (await shouldPerformSync()) {
        await performBackgroundSync();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [notificationsEnabled, notifyJournal, notifyTimetable]);

  if (loading || checkingSavedData) {
    return <LoadingScreen message={loading ? "Входим..." : undefined} />;
  }

  return (
    <div className={`h-screen w-screen overflow-hidden flex flex-col ${themeAppShell(theme)}`}>
      {/* Swipeable Content */}
      <div
        className="flex-1 relative overflow-hidden"
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(-${currentPage * 100}%)`,
            transition: "none",
          }}
        >
          {/* Page 0: Settings */}
          <div className={`w-screen h-full flex-shrink-0 overflow-y-auto ${themePageBg(theme)}`}>
            <SettingsView
              theme={theme}
              onThemeChange={setTheme}
              notificationsEnabled={notificationsEnabled}
              onNotificationsEnabledChange={setNotificationsEnabled}
              notifyJournal={notifyJournal}
              onNotifyJournalChange={setNotifyJournal}
              notifyTimetable={notifyTimetable}
              onNotifyTimetableChange={setNotifyTimetable}
              countdownToLesson={countdownToLesson}
              onCountdownToLessonChange={setCountdownToLesson}
              showReplacementsByDefault={showReplacementsByDefault}
              onShowReplacementsByDefaultChange={setShowReplacementsByDefault}
              timetableDensity={timetableDensity}
              onTimetableDensityChange={setTimetableDensity}
              journalShowAverage={journalShowAverage}
              onJournalShowAverageChange={setJournalShowAverage}
              journalDenseCells={journalDenseCells}
              onJournalDenseCellsChange={setJournalDenseCells}
              journalShowHundredths={journalShowHundredths}
              onJournalShowHundredthsChange={setJournalShowHundredths}
              journalShowTotal={journalShowTotal}
              onJournalShowTotalChange={setJournalShowTotal}
              timetableHideTeacherRoom={timetableHideTeacherRoom}
              onTimetableHideTeacherRoomChange={setTimetableHideTeacherRoom}
              timetableHidePairNumbers={timetableHidePairNumbers}
              onTimetableHidePairNumbersChange={setTimetableHidePairNumbers}
              timetableDayStrip={timetableDayStrip}
              onTimetableDayStripChange={setTimetableDayStrip}
              onClearAppData={handleClearAppData}
            />
              </div>

          {/* Page 1: Timetable Search */}
          <div className={`w-screen h-full flex-shrink-0 overflow-y-auto ${themePageBg(theme)}`}>
            <div className="p-4">
              <TimetableSearchCompact onSelectResult={handleTimetableSelect} />

              {selectedTimetable && (
                <div className="mt-4">
                  <TimetableView
                    data={selectedTimetable}
                    title={selectedResult?.name}
                    subtitle={selectedResult?.typeLabel}
                    onNavigateEntity={handleTimetableEntityNavigate}
                    countdownEnabled={countdownToLesson}
                    defaultShowReplacements={showReplacementsByDefault}
                    density={timetableDensity}
                    hideTeacherRoom={timetableHideTeacherRoom}
                    hidePairNumbers={timetableHidePairNumbers}
                    showDayStrip={timetableDayStrip}
                  />
                </div>
              )}
              {kbpNotice && (
                <div className={`mt-3 text-center text-[11px] ${isDark ? "text-amber-300/80" : "text-amber-700"}`}>
                  {kbpNotice}
            </div>
              )}
          </div>
                </div>

          {/* Page 2: Journal */}
          <div className={`w-screen h-full flex-shrink-0 overflow-y-auto ${themePageBg(theme)}`}>
            {!isLoggedIn ? (
              <div className="min-h-full flex flex-col items-center justify-center p-4">
                <h2 className={`text-xl font-bold mb-2 ${isDark ? "text-slate-100" : "text-gray-900"}`}>Требуется вход</h2>
                <p className={`${isDark ? "text-slate-400" : "text-gray-500"} text-center mb-6`}>Войдите в систему чтобы просматривать журнал</p>
                <form onSubmit={handleLogin} className="w-full max-w-sm space-y-3">
                  <div className={`${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-200"} rounded-xl px-4 py-3 border`}>
                    <input
                      type="text"
                      value={surname}
                      onChange={(e) => setSurname(e.target.value)}
                      className={`w-full bg-transparent focus:outline-none text-base ${isDark ? "text-slate-100 placeholder-slate-500" : "text-gray-900 placeholder-gray-500"}`}
                      placeholder="Фамилия"
                      required
                    />
                  </div>
                  <div className={`${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-200"} rounded-xl px-4 py-3 border`}>
                    <input
                      type="text"
                      value={date}
                      onChange={(e) => setDate(normalizeDateInput(e.target.value))}
                      className={`w-full bg-transparent focus:outline-none text-base ${isDark ? "text-slate-100" : "text-gray-900"}`}
                      placeholder="ДД.ММ.ГГГГ"
                      inputMode="numeric"
                      maxLength={10}
                      required
                    />
                  </div>
                  <div className={`${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-200"} rounded-xl px-4 py-3 border`}>
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => {
                        const next = e.target.value;
                        setGroupSearch(next);
                        const filtered = groups.filter((g) => g.name.toLowerCase().includes(next.toLowerCase()));
                        if (filtered.length === 1) setGroup(filtered[0].id);
                      }}
                      className={`mb-2 w-full bg-transparent focus:outline-none text-sm ${isDark ? "text-slate-300 placeholder-slate-500" : "text-gray-600 placeholder-gray-400"}`}
                      placeholder="Поиск группы"
                    />
                    <select
                      value={group}
                      onChange={(e) => {
                        const nextGroupId = e.target.value;
                        setGroup(nextGroupId);
                        const selectedGroup = groups.find((g) => g.id === nextGroupId);
                        if (selectedGroup) setGroupSearch(selectedGroup.name);
                      }}
                      className={`w-full bg-transparent focus:outline-none text-base appearance-none cursor-pointer ${isDark ? "text-slate-100" : "text-gray-900"}`}
                      required
                      disabled={loadingGroups}
                    >
                      <option value="">{loadingGroups ? "Загрузка групп..." : "Выберите группу"}</option>
                      {groups
                        .filter((g) => !groupSearch.trim() || g.name.toLowerCase().includes(groupSearch.toLowerCase()))
                        .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {groupsNotice && (
                    <div className={`text-xs text-center ${isDark ? "text-amber-300/80" : "text-amber-700"}`}>
                      {groupsNotice}
                    </div>
                  )}
                  {error && <div className="text-red-500 text-sm text-center">{error}</div>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#3390ec] hover:bg-[#2d7fd6] active:bg-[#2870c0] disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-1">
                        <span>Входим</span>
                        <span className="inline-flex items-end gap-0.5" aria-hidden="true">
                          <span className="inline-block h-1 w-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="inline-block h-1 w-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "120ms" }} />
                          <span className="inline-block h-1 w-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "240ms" }} />
                        </span>
                      </span>
                    ) : (
                      "Войти"
                    )}
                  </button>
                </form>
                {loginHistory.length > 0 && (
                  <div className={`mt-4 w-full max-w-sm rounded-[5px] border overflow-hidden ${isDark ? "border-slate-800 bg-slate-950" : "border-gray-200 bg-white"}`}>
                    <div className={`px-3 py-2 text-sm font-semibold border-b ${isDark ? "border-slate-800 text-slate-200" : "border-gray-200 text-gray-900"}`}>
                      История входов
              </div>
                    <div className="max-h-64 overflow-y-auto">
                      {loginHistory.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between px-3 py-2 border-b last:border-b-0 ${isDark ? "border-slate-800" : "border-gray-200"}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSurname(item.surname);
                              setDate(item.date);
                              setGroup(item.group);
                              setGroupSearch(item.groupName);
                            }}
                            className={`text-left text-xs ${isDark ? "text-slate-200" : "text-gray-700"}`}
                          >
                            {item.surname} - {item.date} - {item.groupName}
                          </button>
                          <button
                            type="button"
                            onClick={() => setLoginHistory((prev) => prev.filter((x) => x.id !== item.id))}
                            className={`ml-2 text-xs ${isDark ? "text-red-300" : "text-red-600"}`}
                            aria-label="Удалить из истории"
                          >
                            Удалить
                          </button>
            </div>
                      ))}
          </div>
                  </div>
                )}
              </div>
            ) : journalEntries.length > 0 ? (
              <div className="space-y-3">
                {journalEntries.map((entry) => (
                  <JournalView
                    key={entry.id}
                    data={entry.data}
                    onLogout={() => handleRemoveJournalEntry(entry.id)}
                    theme={theme}
                    studentSurname={entry.surname}
                    groupName={entry.groupName}
                    showAverageColumn={journalShowAverage}
                    denseCells={journalDenseCells}
                    showHundredths={journalShowHundredths}
                    showTotal={journalShowTotal}
                  />
                ))}
              </div>
            ) : (
              <div className="min-h-full flex flex-col items-center justify-center p-4">
                <h2 className={`text-xl font-bold mb-2 ${isDark ? "text-slate-100" : "text-gray-900"}`}>Требуется вход</h2>
                <p className={`${isDark ? "text-slate-400" : "text-gray-500"} text-center mb-6`}>Войдите в систему чтобы просматривать журнал</p>
                <form onSubmit={handleLogin} className="w-full max-w-sm space-y-3">
                  <div className={`${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-200"} rounded-xl px-4 py-3 border`}>
                    <input
                      type="text"
                      value={surname}
                      onChange={(e) => setSurname(e.target.value)}
                      className={`w-full bg-transparent focus:outline-none text-base ${isDark ? "text-slate-100 placeholder-slate-500" : "text-gray-900 placeholder-gray-500"}`}
                      placeholder="Фамилия"
                      required
                    />
                  </div>
                  <div className={`${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-200"} rounded-xl px-4 py-3 border`}>
                    <input
                      type="text"
                      value={date}
                      onChange={(e) => setDate(normalizeDateInput(e.target.value))}
                      className={`w-full bg-transparent focus:outline-none text-base ${isDark ? "text-slate-100" : "text-gray-900"}`}
                      placeholder="ДД.ММ.ГГГГ"
                      inputMode="numeric"
                      maxLength={10}
                      required
                    />
                  </div>
                  <div className={`${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-200"} rounded-xl px-4 py-3 border`}>
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => {
                        const next = e.target.value;
                        setGroupSearch(next);
                        const filtered = groups.filter((g) => g.name.toLowerCase().includes(next.toLowerCase()));
                        if (filtered.length === 1) setGroup(filtered[0].id);
                      }}
                      className={`mb-2 w-full bg-transparent focus:outline-none text-sm ${isDark ? "text-slate-300 placeholder-slate-500" : "text-gray-600 placeholder-gray-400"}`}
                      placeholder="Поиск группы"
                    />
                    <select
                      value={group}
                      onChange={(e) => {
                        const nextGroupId = e.target.value;
                        setGroup(nextGroupId);
                        const selectedGroup = groups.find((g) => g.id === nextGroupId);
                        if (selectedGroup) setGroupSearch(selectedGroup.name);
                      }}
                      className={`w-full bg-transparent focus:outline-none text-base appearance-none cursor-pointer ${isDark ? "text-slate-100" : "text-gray-900"}`}
                      required
                      disabled={loadingGroups}
                    >
                      <option value="">{loadingGroups ? "Загрузка групп..." : "Выберите группу"}</option>
                      {groups
                        .filter((g) => !groupSearch.trim() || g.name.toLowerCase().includes(groupSearch.toLowerCase()))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  {groupsNotice && (
                    <div className={`text-xs text-center ${isDark ? "text-amber-300/80" : "text-amber-700"}`}>
                      {groupsNotice}
                    </div>
                  )}
                  {error && <div className="text-red-500 text-sm text-center">{error}</div>}
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#3390ec] hover:bg-[#2d7fd6] active:bg-[#2870c0] disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-1">
                        <span>Входим</span>
                        <span className="inline-flex items-end gap-0.5" aria-hidden="true">
                          <span className="inline-block h-1 w-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="inline-block h-1 w-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "120ms" }} />
                          <span className="inline-block h-1 w-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "240ms" }} />
                        </span>
                      </span>
                    ) : (
                      "Войти"
                    )}
                </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {(currentPage === 1 && isRefreshingTimetable) || (currentPage === 2 && isRefreshingJournal) ? (
        <div className="px-4 pb-1">
          <div className={`rounded-xl border px-3 py-2 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"}`}>
            <div className="flex items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${isDark ? "bg-blue-900/50 text-blue-200" : "bg-blue-100 text-blue-700"}`}>
                Обновление
              </span>
              <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${isDark ? "bg-zinc-800" : "bg-gray-200"}`}>
                <div className="h-full w-1/3 rounded-full bg-blue-500 animate-[loaderBar_1.1s_ease-in-out_infinite]" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Bottom Navigation */}
      <div className={`${isDark ? "border-slate-800" : "border-gray-200"} border-t z-50`}>
        <div className="flex justify-center items-center py-2 gap-2 px-4">
          {[
            { id: 0, label: "Настройки" },
            { id: 1, label: "Расписание" },
            { id: 2, label: "Журнал" },
          ].map((page) => (
            <button
              key={page.id}
              onClick={() => setCurrentPage(page.id)}
              className={`text-sm font-medium transition-colors relative flex-1 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 ${
                currentPage === page.id
                  ? "text-blue-700 dark:text-blue-400"
                  : isDark
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {page.id === 0 ? (
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.5 7.5 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
                </svg>
              ) : page.id === 1 ? (
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19 3h-1V1h-2v2H8V1H6v2H5a3 3 0 0 0-3 3v13a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3Zm1 16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V10h16v9Z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 2h12a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H6a4 4 0 0 1-4-4V4a2 2 0 0 1 2-2Zm0 2v14a2 2 0 0 0 2 2h12V6a2 2 0 0 0-2-2H4Zm3 3h8v2H7V7Zm0 4h8v2H7v-2Zm0 4h6v2H7v-2Z" />
                </svg>
              )}
              <span>{page.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Journal View Component
function JournalView({
  data,
  onLogout,
  theme,
  studentSurname,
  groupName,
  showAverageColumn = true,
  denseCells = false,
  showHundredths = false,
  showTotal = true,
}: {
  data: any;
  onLogout: () => void;
  theme: AppTheme;
  studentSurname?: string;
  groupName?: string;
  showAverageColumn?: boolean;
  denseCells?: boolean;
  showHundredths?: boolean;
  showTotal?: boolean;
}) {
  const isDark = themeIsDark(theme);
  const cellBg = theme === "oled" ? "#000000" : isDark ? "#1f2630" : "#fefce8";
  const dateColPx = denseCells ? 26 : 32;
  const subjectColPx = denseCells ? 140 : 160;
  const avgColPx = 48;

  const formatAvg = (subject: any): string =>
    formatComputedAverage(calcSubjectAverageFromMarks(subject), showHundredths);

  const totalAvg =
    showTotal && showAverageColumn
      ? calcTotalAverageFromSubjects(data.subjects || [], showHundredths)
      : null;

  const [selectedCell, setSelectedCell] = useState<{
    explanation: string;
    grades: string;
  } | null>(null);

  /* Индекс выделенной строки предмета */
  const [selectedSubjectIdx, setSelectedSubjectIdx] = useState<number | null>(null);

  if (!data?.subjects || data.subjects.length === 0) {
    return (
      <div className="min-h-full flex items-center justify-center p-4">
        <p className={isDark ? "text-slate-400" : "text-gray-500"}>Нет данных журнала</p>
      </div>
    );
  }

  return (
    <div className="p-4 pb-20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className={`text-sm truncate ${isDark ? "text-zinc-300" : "text-gray-700"}`}>
          {studentSurname || "не указана"}
          {groupName ? ` ${groupName}` : ""}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className={`rounded-xl border px-3 py-2 text-sm font-medium active:bg-gray-100 ${
            isDark
              ? "border-slate-800 bg-slate-900 text-slate-100 hover:bg-slate-800 active:bg-slate-800"
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          Выйти
        </button>
      </div>
      <div
        className={`border rounded-lg overflow-x-auto ${
          isDark ? "border-zinc-700 bg-zinc-900" : "border-gray-200 bg-white"
        }`}
      >
        <table
          className="border-collapse text-xs w-full"
          cellSpacing="0"
          cellPadding="0"
          style={{
            tableLayout: "fixed",
            minWidth: `${subjectColPx + (data.dates?.length || 0) * dateColPx + (showAverageColumn ? avgColPx : 0)}px`,
          }}
        >
          <colgroup>
            <col style={{ width: `${subjectColPx}px`, minWidth: `${subjectColPx}px` }} />
            {(data.dates || []).map((_d: string, idx: number) => (
              <col key={idx} style={{ width: `${dateColPx}px`, minWidth: `${Math.max(22, dateColPx - 6)}px`, maxWidth: `${dateColPx}px` }} />
            ))}
            {showAverageColumn ? <col style={{ width: `${avgColPx}px`, minWidth: `${avgColPx}px` }} /> : null}
          </colgroup>
          <thead>
            <tr className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
              <th className="border-r border-gray-200 dark:border-zinc-600 px-2 py-1.5 text-left font-semibold text-[11px] sticky left-0 z-10 bg-gray-50 dark:bg-zinc-800 dark:text-zinc-200">Предмет</th>
              {(data.months || []).map((month: string, i: number) => (
                <th
                  key={`${month}-${i}`}
                  colSpan={(data.monthColspans || [])[i]}
                  className="border-r border-gray-200 dark:border-zinc-600 px-1 py-1.5 text-center font-semibold text-[10px] bg-gray-100/50 dark:bg-zinc-800/75 dark:text-zinc-300"
                >
                  {month}
                </th>
              ))}
              {showAverageColumn ? (
                <th className="border-l-2 border-gray-300 dark:border-zinc-600 px-2 py-1.5 text-center font-semibold text-[11px] bg-gray-50 dark:bg-zinc-800 dark:text-zinc-200">Ср.зн</th>
              ) : null}
            </tr>
            <tr className="bg-gray-50/50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700">
              <td className="border-r border-gray-200 dark:border-zinc-700 sticky left-0 z-10 bg-gray-50/50 dark:bg-zinc-900" />
              {(data.dates || []).map((date: string, idx: number) => (
                <td key={idx} className="border-r border-gray-200 dark:border-zinc-600 px-0.5 py-0.5 text-center text-[9px] text-gray-600 dark:text-zinc-400 font-medium">{date}</td>
              ))}
              {showAverageColumn ? <td className="border-l-2 border-gray-300 dark:border-zinc-600" /> : null}
            </tr>
          </thead>
          <tbody>
            {data.subjects.map((subject: any, idx: number) => {
              const isSelected = selectedSubjectIdx === idx;

              /* Цвета строки: выделена → синий, иначе обычный */
              const rowCellBg = isSelected
                ? isDark ? "#1e3a5f" : "#dbeafe"
                : cellBg;
              const stickyBg = isSelected
                ? isDark ? "#1e3a5f" : "#dbeafe"
                : isDark ? "#18212e" : "#ffffff";

              return (
              <tr
                key={idx}
                onClick={() => setSelectedSubjectIdx(isSelected ? null : idx)}
                className={`border-b cursor-pointer ${
                  isSelected
                    ? isDark ? "border-blue-700" : "border-blue-300"
                    : isDark ? "border-zinc-700 hover:bg-zinc-800/70" : "border-gray-300 hover:bg-blue-50/30"
                }`}
              >
                <td
                  className="border-r border-gray-200 dark:border-zinc-600 px-2 py-1 text-[11px] font-semibold sticky left-0 z-10"
                  style={{ backgroundColor: stickyBg, color: isSelected ? (isDark ? "#93c5fd" : "#1d4ed8") : undefined }}
                >
                  {subject.name}
                </td>
                {(data.dates || []).map((_date: string, dateIdx: number) => {
                  const grades = subject.gradesMatrix?.[dateIdx] || [];
                  const explanation = grades
                    .map((g: any) => g?.type)
                    .filter(Boolean)
                    .join(", ");
                  const gradeValues = grades
                    .map((g: any) => g?.value)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <td
                      key={dateIdx}
                      className="border-r border-gray-300 dark:border-zinc-600 text-center align-middle cursor-pointer"
                      style={{ width: dateColPx, height: dateColPx, backgroundColor: rowCellBg }}
                      onClick={() =>
                        setSelectedCell({
                          explanation: explanation || "Нет пояснения",
                          grades: gradeValues || "Нет оценок",
                        })
                      }
                    >
                      <div className="flex items-center justify-center gap-0.5 flex-wrap">
                        {grades.slice(0, 4).map((grade: any, gIdx: number) => (
                          <span
                            key={gIdx}
                            className="inline-flex items-center justify-center text-[9px] font-medium text-gray-900 dark:text-zinc-200 leading-none"
                            style={
                              grade?.kind === "alert"
                                ? { ...journalMarkAlertStyle("alert"), ...(isDark ? { color: "#f87171" } : {}) }
                                : undefined
                            }
                          >
                            {grade.value}
                          </span>
                        ))}
                      </div>
                    </td>
                  );
                })}
                {showAverageColumn ? (
                  <td
                    className="border-l-2 border-gray-300 dark:border-zinc-600 px-1.5 py-1 text-center font-bold text-[11px]"
                    style={{
                      backgroundColor: isSelected ? (isDark ? "#1e3a5f" : "#bfdbfe") : undefined,
                      borderColor: isSelected ? (isDark ? "#3b82f6" : "#93c5fd") : undefined,
                      color: isSelected ? (isDark ? "#93c5fd" : "#1d4ed8") : (isDark ? "#e4e4e7" : "#111827"),
                    }}
                  >
                    {formatAvg(subject)}
                  </td>
                ) : null}
              </tr>
              );
            })}
          </tbody>

          {/* Строка «Общий балл» */}
          {totalAvg !== null && (
            <tfoot>
              <tr className={`border-t-2 ${isDark ? "border-zinc-600 bg-zinc-800" : "border-gray-300 bg-gray-50"}`}>
                <td
                  className={`px-2 py-1.5 text-[11px] font-bold sticky left-0 z-10 ${
                    isDark ? "bg-zinc-800 text-zinc-200" : "bg-gray-50 text-gray-900"
                  }`}
                >
                  Общий балл
                </td>
                {(data.dates || []).map((_: any, i: number) => (
                  <td key={i} className={`border-r ${isDark ? "border-zinc-700" : "border-gray-200"}`} />
                ))}
                <td className={`border-l-2 px-1.5 py-1.5 text-center font-bold text-[12px] ${
                  isDark ? "border-zinc-600 text-blue-400" : "border-gray-300 text-blue-600"
                }`}>
                  {totalAvg}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
                </div>
      {selectedCell && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            isDark ? "border-zinc-700 bg-zinc-900 text-zinc-200" : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <div><span className="font-semibold">Пояснение:</span> {selectedCell.explanation}</div>
          <div className="mt-1"><span className="font-semibold">Оценки:</span> {selectedCell.grades}</div>
              </div>
            )}
          </div>
  );
}

/* ─── SettingsView ───────────────────────────────────────────────────────────
   Страница настроек приложения.
   Секции: Уведомления, Журнал, Расписание, Тема, Отсчёт, Очистка, О приложении.
   Каждая секция — карточка с разделителями между строками (iOS-стиль).
────────────────────────────────────────────────────────────────────────────── */
function SettingsView(props: {
  theme: AppTheme;
  onThemeChange: (t: AppTheme) => void;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (v: boolean) => void;
  notifyJournal: boolean;
  onNotifyJournalChange: (v: boolean) => void;
  notifyTimetable: boolean;
  onNotifyTimetableChange: (v: boolean) => void;
  countdownToLesson: boolean;
  onCountdownToLessonChange: (v: boolean) => void;
  showReplacementsByDefault: boolean;
  onShowReplacementsByDefaultChange: (v: boolean) => void;
  timetableDensity: "normal" | "compact" | "small";
  onTimetableDensityChange: (v: "normal" | "compact" | "small") => void;
  journalShowAverage: boolean;
  onJournalShowAverageChange: (v: boolean) => void;
  journalDenseCells: boolean;
  onJournalDenseCellsChange: (v: boolean) => void;
  journalShowHundredths: boolean;
  onJournalShowHundredthsChange: (v: boolean) => void;
  journalShowTotal: boolean;
  onJournalShowTotalChange: (v: boolean) => void;
  timetableHideTeacherRoom: boolean;
  onTimetableHideTeacherRoomChange: (v: boolean) => void;
  timetableHidePairNumbers: boolean;
  onTimetableHidePairNumbersChange: (v: boolean) => void;
  timetableDayStrip: boolean;
  onTimetableDayStripChange: (v: boolean) => void;
  onClearAppData: (opts: { clearCache: boolean; clearLoginHistory: boolean; clearTimetables: boolean }) => void;
}) {
  const {
    theme,
    onThemeChange,
    notificationsEnabled,
    onNotificationsEnabledChange,
    notifyJournal,
    onNotifyJournalChange,
    notifyTimetable,
    onNotifyTimetableChange,
    countdownToLesson,
    onCountdownToLessonChange,
    showReplacementsByDefault,
    onShowReplacementsByDefaultChange,
    timetableDensity,
    onTimetableDensityChange,
    journalShowAverage,
    onJournalShowAverageChange,
    journalDenseCells,
    onJournalDenseCellsChange,
    journalShowHundredths,
    onJournalShowHundredthsChange,
    journalShowTotal,
    onJournalShowTotalChange,
    timetableHideTeacherRoom,
    onTimetableHideTeacherRoomChange,
    timetableHidePairNumbers,
    onTimetableHidePairNumbersChange,
    timetableDayStrip,
    onTimetableDayStripChange,
    onClearAppData,
  } = props;

  const isDark = themeIsDark(theme);

  const [clearCache, setClearCache] = useState(false);
  const [clearLoginHistory, setClearLoginHistory] = useState(false);
  const [clearTimetables, setClearTimetables] = useState(false);

  /* Базовые классы секции и строки */
  const sectionCard = `rounded-2xl overflow-hidden ${
    isDark ? "bg-zinc-900 border border-zinc-800" : "bg-white border border-gray-100 shadow-sm"
  }`;
  const divider = `${isDark ? "border-zinc-800" : "border-gray-100"}`;
  const rowBase = `flex items-center justify-between gap-4 px-4 py-3.5`;
  const labelPrimary = `text-sm ${isDark ? "text-zinc-100" : "text-gray-900"}`;
  const labelSecondary = `text-sm ${isDark ? "text-zinc-400" : "text-gray-500"}`;
  const sectionHeader = `px-4 pt-5 pb-2 text-xs font-semibold tracking-widest uppercase ${
    isDark ? "text-zinc-500" : "text-gray-400"
  }`;

  return (
    <div className="pb-24">

      {/* ── Заголовок ── */}
      <div className={`flex items-center gap-3 px-4 pt-5 pb-4 ${isDark ? "border-zinc-800" : "border-gray-100"}`}>
        <img src="/minikbp.svg" alt="" className="h-10 w-10 shrink-0 object-contain" width={40} height={40} />
        <h2 className={`text-xl font-bold tracking-tight ${isDark ? "text-zinc-100" : "text-gray-900"}`}>
          Настройки
        </h2>
      </div>

      {/* ══════════════════════════════════════════
          СЕКЦИЯ: Внешний вид
      ══════════════════════════════════════════ */}
      <div className={sectionHeader}>Внешний вид</div>
      <div className={sectionCard}>

        {/* Тема — визуальные карточки */}
        <div className={`px-4 py-3.5 border-b ${divider}`}>
          <div className={`text-sm font-medium mb-3 ${isDark ? "text-zinc-100" : "text-gray-900"}`}>Тема</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "light" as AppTheme, label: "Светлая", preview: "border border-gray-200 bg-white" },
              { id: "dark"  as AppTheme, label: "Тёмная",  preview: "border border-zinc-700 bg-zinc-900" },
              { id: "oled"  as AppTheme, label: "OLED",    preview: "border border-zinc-800 bg-black" },
            ].map((opt) => {
              const active = theme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onThemeChange(opt.id)}
                  className={`rounded-xl p-2.5 text-left transition-all ${
                    active
                      ? isDark
                        ? "bg-blue-500/10 ring-2 ring-blue-500"
                        : "bg-blue-50 ring-2 ring-blue-500"
                      : isDark
                        ? "bg-zinc-800 ring-1 ring-zinc-700"
                        : "bg-gray-50 ring-1 ring-gray-200"
                  }`}
                >
                  <div className={`h-9 rounded-lg ${opt.preview}`} />
                  <div className={`mt-2 text-xs font-medium truncate ${
                    active ? "text-blue-500" : isDark ? "text-zinc-300" : "text-gray-700"
                  }`}>
                    {opt.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════
          СЕКЦИЯ: Уведомления
      ══════════════════════════════════════════ */}
      <div className={sectionHeader}>Уведомления</div>
      <div className={sectionCard}>

        <label className={`${rowBase}`}>
          <span className={labelPrimary}>Включить уведомления</span>
          <ToggleSwitch checked={notificationsEnabled} onChange={onNotificationsEnabledChange} isDark={isDark} />
        </label>

        {/* Подопции уведомлений — плавное раскрытие */}
        <div className={`overflow-hidden transition-all duration-300 ease-out ${
          notificationsEnabled ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
        }`}>
          <label className={`${rowBase} border-t ${divider}`}>
            <div>
              <div className={labelPrimary}>Журнал</div>
              <div className={labelSecondary}>Уведомлять об изменениях в оценках</div>
            </div>
            <ToggleSwitch checked={notifyJournal} onChange={onNotifyJournalChange} isDark={isDark} />
          </label>
          <label className={`${rowBase} border-t ${divider}`}>
            <div>
              <div className={labelPrimary}>Расписание</div>
              <div className={labelSecondary}>Уведомлять об изменениях</div>
            </div>
            <ToggleSwitch checked={notifyTimetable} onChange={onNotifyTimetableChange} isDark={isDark} />
          </label>
        </div>

      </div>

      {/* ══════════════════════════════════════════
          СЕКЦИЯ: Журнал
      ══════════════════════════════════════════ */}
      <div className={sectionHeader}>Журнал</div>
      <div className={sectionCard}>

        <label className={`${rowBase}`}>
          <span className={labelPrimary}>Показывать колонку «Ср. зн.»</span>
          <ToggleSwitch checked={journalShowAverage} onChange={onJournalShowAverageChange} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <span className={labelPrimary}>Плотнее ячейки с датами</span>
          <ToggleSwitch checked={journalDenseCells} onChange={onJournalDenseCellsChange} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <div>
            <div className={labelPrimary}>Сотые в среднем балле</div>
            <div className={labelSecondary}>Например: 7.45 вместо 7.5</div>
          </div>
          <ToggleSwitch checked={journalShowHundredths} onChange={onJournalShowHundredthsChange} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <div>
            <div className={labelPrimary}>Общий балл</div>
            <div className={labelSecondary}>Среднее по всем предметам</div>
          </div>
          <ToggleSwitch checked={journalShowTotal} onChange={onJournalShowTotalChange} isDark={isDark} />
        </label>

      </div>

      {/* ══════════════════════════════════════════
          СЕКЦИЯ: Расписание
      ══════════════════════════════════════════ */}
      <div className={sectionHeader}>Расписание</div>
      <div className={sectionCard}>

        <label className={`${rowBase}`}>
          <span className={labelPrimary}>Показывать замены по умолчанию</span>
          <ToggleSwitch checked={showReplacementsByDefault} onChange={onShowReplacementsByDefaultChange} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <span className={`${labelPrimary} pr-8`}>Скрыть преподавателя и аудиторию</span>
          <ToggleSwitch checked={timetableHideTeacherRoom} onChange={onTimetableHideTeacherRoomChange} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <span className={labelPrimary}>Скрыть номер пары слева</span>
          <ToggleSwitch checked={timetableHidePairNumbers} onChange={onTimetableHidePairNumbersChange} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <span className={labelPrimary}>Панель дней (Пн–Сб)</span>
          <ToggleSwitch checked={timetableDayStrip} onChange={onTimetableDayStripChange} isDark={isDark} />
        </label>

        {/* Плотность расписания — сегментированный контрол */}
        <div className={`px-4 py-3.5 border-t ${divider}`}>
          <div className={`text-sm font-medium mb-3 ${isDark ? "text-zinc-100" : "text-gray-900"}`}>
            Плотность расписания
          </div>
          <div className={`flex rounded-xl overflow-hidden border ${isDark ? "border-zinc-700" : "border-gray-200"}`}>
            {([
              { id: "normal",  label: "Обычная"  },
              { id: "compact", label: "Компакт." },
              { id: "small",   label: "Мини"     },
            ] as const).map((opt, i, arr) => {
              const active = timetableDensity === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onTimetableDensityChange(opt.id)}
                  className={`flex-1 py-2 text-xs font-semibold transition-all ${
                    i < arr.length - 1 ? `border-r ${isDark ? "border-zinc-700" : "border-gray-200"}` : ""
                  } ${
                    active
                      ? "bg-blue-500 text-white"
                      : isDark
                        ? "bg-transparent text-zinc-400 hover:text-zinc-200"
                        : "bg-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════
          СЕКЦИЯ: Прочее
      ══════════════════════════════════════════ */}
      <div className={sectionHeader}>Прочее</div>
      <div className={sectionCard}>

        <label className={`${rowBase}`}>
          <div>
            <div className={labelPrimary}>Отсчёт до урока</div>
            <div className={labelSecondary}>Показывать таймер в расписании</div>
          </div>
          <ToggleSwitch checked={countdownToLesson} onChange={onCountdownToLessonChange} isDark={isDark} />
        </label>

      </div>

      {/* ══════════════════════════════════════════
          СЕКЦИЯ: Очистка данных
      ══════════════════════════════════════════ */}
      <div className={sectionHeader}>Очистка данных</div>
      <div className={sectionCard}>

        <label className={`${rowBase}`}>
          <span className={labelPrimary}>Кэш журнала</span>
          <ToggleSwitch checked={clearCache} onChange={setClearCache} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <span className={labelPrimary}>История входов</span>
          <ToggleSwitch checked={clearLoginHistory} onChange={setClearLoginHistory} isDark={isDark} />
        </label>

        <label className={`${rowBase} border-t ${divider}`}>
          <span className={labelPrimary}>Загруженные расписания</span>
          <ToggleSwitch checked={clearTimetables} onChange={setClearTimetables} isDark={isDark} />
        </label>

        <div className={`px-4 py-3.5 border-t ${divider}`}>
          <button
            type="button"
            onClick={() => onClearAppData({ clearCache, clearLoginHistory, clearTimetables })}
            disabled={!(clearCache || clearLoginHistory || clearTimetables)}
            className={`w-full rounded-xl py-3 px-4 text-sm font-semibold transition-all ${
              clearCache || clearLoginHistory || clearTimetables
                ? "bg-rose-500 text-white active:scale-[0.98]"
                : isDark
                  ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Очистить выбранное
          </button>
        </div>

      </div>

      {/* ══════════════════════════════════════════
          СЕКЦИЯ: О приложении
      ══════════════════════════════════════════ */}
      <div className={sectionHeader}>О приложении</div>
      <div className={sectionCard}>

        <div className={`${rowBase} border-b ${divider}`}>
          <span className={labelPrimary}>Версия</span>
          <span className={`text-sm font-medium ${isDark ? "text-zinc-400" : "text-gray-500"}`}>
            Release 0.1.71
          </span>
        </div>

        {/* Ссылки — каждая строка со стрелкой */}
        {[
          {
            href: "https://www.donationalerts.com/r/meowhiks_off",
            label: "Поддержать разработку",
            sub: "DonationAlerts",
            color: "text-[#ff5dc5]",
            icon: (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2 9.5 6H5.2l2.6 3.1L6.6 14l5.4-2.6L17.4 14l-1.2-4.9L18.8 6H14.5L12 2Zm-7 14h14v2H5v-2Zm1 4h12v2H6v-2Z" />
              </svg>
            ),
            bg: "bg-[#ff5dc5]/10",
          },
          {
            href: "https://t.me/meowhiks",
            label: "Telegram",
            sub: "@meowhiks",
            color: "text-[#229ED9]",
            icon: (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.94 4.66c.3-.95-.64-1.82-1.53-1.43L3.17 9.53c-1.03.37-1 1.84.04 2.16l4.2 1.28 1.6 4.9c.31.96 1.6 1.17 2.2.37l2.36-3.14 4.15 3.07c.76.56 1.84.14 2.05-.8l2.17-12.71Z" />
              </svg>
            ),
            bg: "bg-[#229ED9]/10",
          },
          {
            href: "https://github.com/meowhiks",
            label: "GitHub",
            sub: "meowhiks",
            color: isDark ? "text-zinc-200" : "text-gray-800",
            icon: (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.1.82-.26.82-.58v-2.2c-3.34.73-4.05-1.61-4.05-1.61-.55-1.4-1.34-1.77-1.34-1.77-1.1-.76.08-.74.08-.74 1.21.09 1.85 1.24 1.85 1.24 1.08 1.86 2.84 1.32 3.53 1 .11-.79.42-1.32.76-1.62-2.67-.3-5.48-1.34-5.48-5.95 0-1.32.47-2.4 1.24-3.25-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.24a11.5 11.5 0 0 1 6 0c2.29-1.56 3.3-1.24 3.3-1.24.66 1.65.24 2.88.12 3.18.77.85 1.24 1.93 1.24 3.25 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.82.58A12 12 0 0 0 12 .5Z" />
              </svg>
            ),
            bg: isDark ? "bg-zinc-700" : "bg-gray-200",
          },
        ].map((link, i, arr) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className={`${rowBase} no-underline group ${i < arr.length - 1 ? `border-b ${divider}` : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${link.bg} ${link.color}`}>
                {link.icon}
              </span>
              <div>
                <div className={`text-sm font-medium ${isDark ? "text-zinc-100" : "text-gray-900"}`}>
                  {link.label}
                </div>
                <div className={labelSecondary}>{link.sub}</div>
              </div>
            </div>
            <svg
              className={`h-4 w-4 shrink-0 ${isDark ? "text-zinc-600" : "text-gray-300"}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>
        ))}

      </div>

      {/* Нижний отступ */}
      <div className="h-4" />
    </div>
  );
}

/* ─── ToggleSwitch ───────────────────────────────────────────────────────────
   Переключатель: включён/выключён.
   Props: checked — текущее состояние, onChange — коллбэк, isDark — тема.
────────────────────────────────────────────────────────────────────────────── */
function ToggleSwitch({
  checked,
  onChange,
  isDark,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  isDark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[28px] w-[50px] shrink-0 items-center rounded-full transition-colors duration-200 ${
        checked ? "bg-blue-500" : isDark ? "bg-zinc-700" : "bg-gray-200"
      }`}
      aria-pressed={checked}
    >
      <span
        className={`inline-block h-[22px] w-[22px] transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-[24px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}