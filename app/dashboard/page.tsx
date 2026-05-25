"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchJournal as fetchJournalApi,
  fetchTimetable as fetchTimetableApi,
  login,
  fetchStudentFIO,
  getCachedFIO,
  getCachedJournal,
  getCachedTimetable,
  journalDataNeedsKindRefresh,
  journalMarkAlertStyle,
} from "@/lib/client/kbpApi";
import {
  getTimetableDayCount,
  getTimetableDayShortLabels,
  getTimetableDisplayDay,
  TIMETABLE_SLOT_NEXT_MONDAY,
} from "@/lib/client/timetableDisplay";
import { isNativeApp } from "@/lib/client/platform";
import { storageGet, storageSet, storageRemove } from "@/lib/client/storage";
import { requestNotificationPermissions } from "@/lib/client/notifications";
import { performBackgroundSync, shouldPerformSync } from "@/lib/client/backgroundSync";

interface Subject {
  id: string;
  name: string;
  gradesMatrix: Record<number, Array<{ value: string; type: string; kind?: "normal" | "alert" }>>;
  average: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [journalData, setJournalData] = useState<any>(null);
  const [timetableData, setTimetableData] = useState<any>(null);
  const [studentFIO, setStudentFIO] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRefreshingJournal, setIsRefreshingJournal] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [notifLink, setNotifLink] = useState<string | null>(null);
  const [notifToken, setNotifToken] = useState<string | null>(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [notifCopied, setNotifCopied] = useState(false);
  const native = isNativeApp();

  /* Выбранная строка предмета в таблице журнала */
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);

  const handleLogout = async () => {
    await storageRemove("ej_login_data");
    await storageRemove("ej_cookies");
    await storageRemove("ej_group_id");
    await storageRemove("cached_journal_data");
    await storageRemove("cached_timetable_data");
    await storageRemove("cached_student_fio");
    await storageRemove("ej_auto_login_enabled");
    router.push("/");
  };

  const handleEnableNotifications = async () => {
    setNotifError("");
    setNotifCopied(false);
    setNotifLoading(true);
    try {
      if (native) {
        setNotifError("В нативной сборке уведомления требуют отдельного сервера. Используйте веб-версию.");
        return;
      }
      const cookies = await storageGet("ej_cookies");
      const loginDataStr = await storageGet("ej_login_data");
      if (!cookies || !loginDataStr) {
        setNotifError("Нужно заново войти, чтобы включить уведомления.");
        return;
      }

      const loginData = JSON.parse(loginDataStr);
      const response = await fetch("/api/bot/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_name: loginData.student_name,
          group_id: loginData.group_id,
          birth_day: loginData.birth_day,
          cookies,
        }),
      });
      const result = await response.json();
      if (result.success && result.link && result.token) {
        setNotifLink(result.link);
        setNotifToken(result.token);
      } else {
        setNotifError(result.error || "Не удалось создать ссылку.");
      }
    } catch (err) {
      console.error("Enable notifications error:", err);
      setNotifError("Не удалось включить уведомления. Попробуйте позже.");
    } finally {
      setNotifLoading(false);
    }
  };

  const copyToken = async () => {
    if (!notifToken) return;
    try {
      await navigator.clipboard.writeText(notifToken);
      setNotifCopied(true);
      setTimeout(() => setNotifCopied(false), 1500);
    } catch {
      setNotifError("Не удалось скопировать токен.");
    }
  };

  useEffect(() => {
    // Load data - first from cache (for instant display), then refresh from network
    const loadData = async () => {
      console.log("[Dashboard] Starting data load...");

      // 1. Load FIO from cache first
      const cachedFIO = await getCachedFIO();
      if (cachedFIO) {
        setStudentFIO(cachedFIO);
        console.log("[Dashboard] Loaded cached FIO:", cachedFIO);
      }

      // 2. Load journal from cache first
      const cachedJournal = await getCachedJournal();
      const cacheHasKind = cachedJournal && !journalDataNeedsKindRefresh(cachedJournal);
      if (cacheHasKind) {
        setJournalData(cachedJournal);
        setLoading(false);
        console.log("[Dashboard] Loaded cached journal with", cachedJournal.subjects?.length, "subjects");
      }

      // 3. Load timetable from cache first
      const cachedTimetable = await getCachedTimetable();
      if (cachedTimetable) {
        setTimetableData(cachedTimetable);
        console.log("[Dashboard] Loaded cached timetable");
      }

      // 4. Try to refresh FIO from network in background
      try {
        const fioResult = await fetchStudentFIO();
        if (fioResult.success && fioResult.fio) {
          setStudentFIO(fioResult.fio);
          console.log("[Dashboard] Updated FIO from network:", fioResult.fio);
        }
      } catch (err) {
        console.log("[Dashboard] Could not refresh FIO:", err);
        // Don't show error - we have cached data
      }

      // 5. Try to refresh journal from network in background
      try {
        setIsRefreshingJournal(true);
        const journalResult = await fetchJournalApi();
        if (journalResult.success && journalResult.data) {
          setJournalData(journalResult.data);
          setError("");
          console.log("[Dashboard] Updated journal from network");
        } else if (!cacheHasKind) {
          setError(journalResult.error || "Ошибка загрузки журнала");
        }
      } catch (err) {
        console.error("[Dashboard] Error refreshing journal:", err);
        if (!cacheHasKind) {
          setError("Нет подключения к интернету. Проверьте соединение.");
        }
      } finally {
        setIsRefreshingJournal(false);
      }

      // 6. Try to refresh timetable from network in background
      const savedGroupId = await storageGet("ej_group_id");
      if (savedGroupId) {
        try {
          const timetableResult = await fetchTimetableApi(savedGroupId);
          if (timetableResult.success && timetableResult.data) {
            setTimetableData(timetableResult.data);
            console.log("[Dashboard] Updated timetable from network");
          }
        } catch (err) {
          console.error("[Dashboard] Error refreshing timetable:", err);
          // Don't show error for timetable - it's secondary
        }
      }

      setLoading(false);
    };

    loadData();

    // Request notification permissions on app start
    if (native) {
      requestNotificationPermissions();
    }
  }, []);

  // Refresh journal on app return (after ~5 minutes in background)
  useEffect(() => {
    let lastHiddenAt = 0;

    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAt = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      if (!lastHiddenAt) return;
      const idleMs = Date.now() - lastHiddenAt;
      lastHiddenAt = 0;
      if (idleMs < 5 * 60 * 1000) return;

      console.log("[Dashboard] App resumed after idle, refreshing journal...");
      setIsRefreshingJournal(true);
      try {
        const journalResult = await fetchJournalApi();
        if (journalResult.success && journalResult.data) {
          setJournalData(journalResult.data);
          setError("");
        }
      } catch (e) {
        console.error("[Dashboard] Resume refresh failed:", e);
      } finally {
        setTimeout(() => setIsRefreshingJournal(false), 350);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Periodic journal refresh while dashboard is open (every 5 minutes)
  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        setIsRefreshingJournal(true);
        const journalResult = await fetchJournalApi();
        if (journalResult.success && journalResult.data) {
          setJournalData(journalResult.data);
          setError("");
        }
      } catch (e) {
        console.error("[Dashboard] Periodic refresh failed:", e);
      } finally {
        setTimeout(() => setIsRefreshingJournal(false), 350);
      }
    }, 5 * 60 * 1000);

    return () => window.clearInterval(id);
  }, []);

  // Background sync effect - runs when dashboard is visible
  useEffect(() => {
    if (!native) return;

    // Check for updates every 15 minutes
    const checkInterval = setInterval(async () => {
      const needsSync = await shouldPerformSync();
      if (needsSync) {
        console.log("[Dashboard] Performing background sync...");
        await performBackgroundSync();
      }
    }, 15 * 60 * 1000); // Every 15 minutes

    // Also check immediately if needed
    shouldPerformSync().then((needsSync) => {
      if (needsSync) {
        console.log("[Dashboard] Initial background sync...");
        performBackgroundSync();
      }
    });

    return () => clearInterval(checkInterval);
  }, [native]);

  if (loading && !journalData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-gray-500 mb-2">Загрузка журнала...</div>
          {error && <div className="text-sm text-gray-400 mt-2">{error}</div>}
        </div>
      </div>
    );
  }

  if (error && !journalData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="text-center">
          <h1 className="text-2xl font-medium text-gray-900 mb-4">Ошибка загрузки</h1>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={handleLogout}
            className="bg-[#3390ec] hover:bg-[#2d7fd6] text-white font-medium py-2 px-4 rounded-xl transition-colors"
          >
            Войти заново
          </button>
        </div>
      </div>
    );
  }

  if (!journalData || !journalData.subjects || journalData.subjects.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="text-center">
          <h1 className="text-2xl font-medium text-gray-900 mb-4">Данные журнала не найдены</h1>
          <p className="text-gray-500 mb-4">Пожалуйста, войдите снова для получения данных</p>
          <button
            onClick={handleLogout}
            className="bg-[#3390ec] hover:bg-[#2d7fd6] text-white font-medium py-2 px-4 rounded-xl transition-colors"
          >
            Войти
          </button>
        </div>
      </div>
    );
  }

  const dates = journalData.dates || [];
  const months = journalData.months || [];
  const monthColspans = journalData.monthColspans || [];

  // Вычисляем позиции месяцев
  let monthStartPositions: number[] = [];
  let currentPos = 0;
  monthColspans.forEach((colspan: number) => {
    monthStartPositions.push(currentPos);
    currentPos += colspan;
  });

  const normalizeSubjectName = (name: string) => {
    return name
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[.,\-_]/g, "")
      .trim();
  };

  const getSubjectGrades = (subjectName: string) => {
    if (!journalData || !journalData.subjects) return null;
    const normalizedTimetableName = normalizeSubjectName(subjectName);
    const subject = journalData.subjects.find((s: Subject) => {
      const normalizedJournalName = normalizeSubjectName(s.name);
      return (
        normalizedJournalName === normalizedTimetableName ||
        normalizedJournalName.includes(normalizedTimetableName) ||
        normalizedTimetableName.includes(normalizedJournalName)
      );
    });
    return subject;
  };

  const getMonthForDateIndex = (dateIndex: number) => {
    if (!journalData || !journalData.monthColspans || !journalData.months) return null;

    let currentPos = 0;
    for (let i = 0; i < journalData.monthColspans.length; i++) {
      const colspan = journalData.monthColspans[i];
      if (dateIndex >= currentPos && dateIndex < currentPos + colspan) {
        return {
          monthIndex: i,
          monthName: journalData.months[i],
        };
      }
      currentPos += colspan;
    }
    return null;
  };

  const parseMonthName = (monthName: string): number | null => {
    const monthNames: Record<string, number> = {
      январь: 0,
      февраль: 1,
      март: 2,
      апрель: 3,
      май: 4,
      июнь: 5,
      июль: 6,
      август: 7,
      сентябрь: 8,
      октябрь: 9,
      ноябрь: 10,
      декабрь: 11,
    };
    const normalized = monthName.toLowerCase().trim();
    return monthNames[normalized] !== undefined ? monthNames[normalized] : null;
  };

  const getDateIndexForWeekDay = (weekDay: number) => {
    if (!journalData || !journalData.dates || !journalData.months || !journalData.monthColspans) return null;

    const today = new Date();
    const currentDayOfWeek = today.getDay();
    const mondayOffset = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    const targetDate = new Date(monday);
    targetDate.setDate(monday.getDate() + weekDay);

    const targetDay = targetDate.getDate();
    const targetMonth = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();

    for (let dateIndex = 0; dateIndex < journalData.dates.length; dateIndex++) {
      const dateStr = journalData.dates[dateIndex];
      const dateDay = parseInt(dateStr);

      if (dateDay === targetDay) {
        const monthInfo = getMonthForDateIndex(dateIndex);
        if (monthInfo) {
          const journalMonth = parseMonthName(monthInfo.monthName);
          if (journalMonth !== null && journalMonth === targetMonth) {
            return dateIndex;
          }
        }
      }
    }

    return null;
  };

  const getGradesForWeekDay = (subject: Subject | null, weekDay: number) => {
    if (!subject || !subject.gradesMatrix) return [];
    const dateIdx = getDateIndexForWeekDay(weekDay);
    if (dateIdx === null) return [];
    return subject.gradesMatrix[dateIdx] || [];
  };

  const getCurrentPair = () => {
    if (!timetableData || !timetableData.pairs) return null;

    const now = new Date();
    const currentDay = now.getDay();
    const dayIndex = currentDay === 0 ? 6 : currentDay - 1;

    if (dayIndex >= 6) return null;

    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTime = currentHours * 60 + currentMinutes;

    const dayPairs = timetableData.pairs.filter((p: any) => {
      if ((p.weekOffset ?? 0) !== 0) return false;
      if (p.day !== dayIndex) return false;
      if (!p.subject) return false;
      const subjectTrimmed = p.subject.trim();
      if (subjectTrimmed === "") return false;
      if (subjectTrimmed.toLowerCase().includes("урок снят")) return false;
      if (subjectTrimmed === "Урок снят") return false;
      if (p.status === "removed") return false;
      if (p.status === "cancelled") return false;
      return p.status === "added" || p.status === "normal" || p.status === "replaced" || !p.status;
    });

    if (dayPairs.length === 0) return null;

    const getPairTimeMinutes = (timeStr: string): number => {
      const [hours, minutes] = timeStr.split(".").map(Number);
      return hours * 60 + minutes;
    };

    for (const pair of dayPairs.sort((a: any, b: any) => a.pairNumber - b.pairNumber)) {
      const pairTime = getPairTime(pair.pairNumber, dayIndex);
      if (!pairTime.start || !pairTime.end) continue;

      const startMinutes = getPairTimeMinutes(pairTime.start);
      const endMinutes = getPairTimeMinutes(pairTime.end);

      if (currentTime >= startMinutes && currentTime <= endMinutes) {
        return { pairNumber: pair.pairNumber, day: dayIndex };
      }
    }

    for (const pair of dayPairs.sort((a: any, b: any) => a.pairNumber - b.pairNumber)) {
      const pairTime = getPairTime(pair.pairNumber, dayIndex);
      if (!pairTime.start) continue;

      const startMinutes = getPairTimeMinutes(pairTime.start);

      if (currentTime < startMinutes) {
        return { pairNumber: pair.pairNumber, day: dayIndex };
      }
    }

    return null;
  };

  const getPairTime = (pairNumber: number, dayIndex: number): { start: string; end: string } => {
    const schedule: Record<number, Record<number, { start: string; end: string }>> = {
      0: {
        1: { start: "8.00", end: "8.45" },
        2: { start: "8.55", end: "9.40" },
        3: { start: "9.50", end: "10.35" },
        4: { start: "10.45", end: "11.30" },
        5: { start: "12.00", end: "12.45" },
        6: { start: "12.55", end: "13.40" },
        7: { start: "14.00", end: "14.45" },
        8: { start: "14.55", end: "15.40" },
        9: { start: "16.00", end: "16.45" },
        10: { start: "16.55", end: "17.40" },
        11: { start: "17.50", end: "18.35" },
        12: { start: "18.45", end: "19.30" },
        13: { start: "19.40", end: "20.25" },
      },
      1: {
        1: { start: "8.00", end: "8.45" },
        2: { start: "8.55", end: "9.40" },
        3: { start: "9.50", end: "10.35" },
        4: { start: "10.45", end: "11.30" },
        5: { start: "12.00", end: "12.45" },
        6: { start: "12.55", end: "13.40" },
        7: { start: "14.00", end: "14.45" },
        8: { start: "14.55", end: "15.40" },
        9: { start: "16.00", end: "16.45" },
        10: { start: "16.55", end: "17.40" },
        11: { start: "17.50", end: "18.35" },
        12: { start: "18.45", end: "19.30" },
        13: { start: "19.40", end: "20.25" },
      },
      2: {
        1: { start: "8.00", end: "8.45" },
        2: { start: "8.55", end: "9.40" },
        3: { start: "9.50", end: "10.35" },
        4: { start: "10.45", end: "11.30" },
        5: { start: "12.00", end: "12.45" },
        6: { start: "12.55", end: "13.40" },
        7: { start: "14.00", end: "14.45" },
        8: { start: "14.55", end: "15.40" },
        9: { start: "16.00", end: "16.45" },
        10: { start: "16.55", end: "17.40" },
        11: { start: "17.50", end: "18.35" },
        12: { start: "18.45", end: "19.30" },
        13: { start: "19.40", end: "20.25" },
      },
      3: {
        1: { start: "8.00", end: "8.45" },
        2: { start: "8.55", end: "9.40" },
        3: { start: "9.50", end: "10.35" },
        4: { start: "10.45", end: "11.30" },
        5: { start: "12.00", end: "12.45" },
        6: { start: "12.55", end: "13.40" },
        7: { start: "14.40", end: "15.25" },
        8: { start: "15.35", end: "16.20" },
        9: { start: "16.30", end: "17.15" },
        10: { start: "17.25", end: "18.10" },
        11: { start: "18.20", end: "19.05" },
        12: { start: "19.15", end: "20.00" },
        13: { start: "20.10", end: "20.55" },
      },
      4: {
        1: { start: "8.00", end: "8.45" },
        2: { start: "8.55", end: "9.40" },
        3: { start: "9.50", end: "10.35" },
        4: { start: "10.45", end: "11.30" },
        5: { start: "12.00", end: "12.45" },
        6: { start: "12.55", end: "13.40" },
        7: { start: "14.00", end: "14.45" },
        8: { start: "14.55", end: "15.40" },
        9: { start: "16.00", end: "16.45" },
        10: { start: "16.55", end: "17.40" },
        11: { start: "17.50", end: "18.35" },
        12: { start: "18.45", end: "19.30" },
        13: { start: "19.40", end: "20.25" },
      },
      5: {
        1: { start: "8.00", end: "8.45" },
        2: { start: "8.55", end: "9.40" },
        3: { start: "9.50", end: "10.35" },
        4: { start: "10.45", end: "11.30" },
        5: { start: "11.40", end: "12.25" },
        6: { start: "12.35", end: "13.20" },
        7: { start: "13.40", end: "14.25" },
        8: { start: "14.35", end: "15.20" },
        9: { start: "15.30", end: "16.15" },
        10: { start: "16.25", end: "17.10" },
        11: { start: "17.20", end: "18.05" },
        12: { start: "18.15", end: "19.00" },
        13: { start: "19.10", end: "19.55" },
      },
    };

    return schedule[dayIndex]?.[pairNumber] || { start: "", end: "" };
  };

  const currentPair = getCurrentPair();

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        {isRefreshingJournal && (
          <div className="sticky top-2 z-50 px-1">
            <div className="mx-auto w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 shadow-sm">
              Обновление…
            </div>
          </div>
        )}
        {/* Header with FIO and logout */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-gray-900">Электронный журнал</h1>
            {studentFIO && (
              <span className="text-sm text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                {studentFIO}
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-red-600 hover:text-red-700 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
          >
            Выйти
          </button>
        </div>

        {/* Journal table */}
        <div className="border border-gray-200 rounded-lg overflow-x-auto shadow-sm bg-white">
          <table className="border-collapse text-xs" cellSpacing="0" cellPadding="0" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "128px", minWidth: "128px" }} />
              {dates.map((_date: string, idx: number) => (
                <col key={idx} style={{ width: "32px", minWidth: "24px", maxWidth: "32px" }} />
              ))}
              <col style={{ width: "48px", minWidth: "48px" }} />
            </colgroup>
            {/* Заголовок с месяцами */}
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="border-r border-gray-200 px-2 py-1.5 text-left font-semibold text-[11px] sticky left-0 z-10 bg-gray-50">
                  Предмет
                </th>
                {monthStartPositions.map((startPos, idx) => (
                  <th
                    key={idx}
                    colSpan={monthColspans[idx]}
                    className="border-r border-gray-200 px-1 py-1.5 text-center font-semibold text-[10px] bg-gray-100/50"
                  >
                    {months[idx]}
                  </th>
                ))}
                <th className="border-l-2 border-gray-300 px-2 py-1.5 text-center font-semibold text-[11px] bg-gray-50">Ср.зн</th>
              </tr>
              <tr className="bg-gray-50/50 border-b border-gray-200">
                <td className="border-r border-gray-200 sticky left-0 z-10 bg-gray-50/50"></td>
                {dates.map((date: string, idx: number) => (
                  <td
                    key={idx}
                    className="border-r border-gray-200 px-0.5 py-0.5 text-center text-[9px] text-gray-600 font-medium"
                  >
                    {date}
                  </td>
                ))}
                <td className="border-l-2 border-gray-300"></td>
              </tr>
            </thead>
            <tbody>
              {journalData.subjects.map((subject: Subject) => {
                const isSelected = selectedSubjectId === subject.id;
                return (
                <tr
                  key={subject.id}
                  onClick={() => setSelectedSubjectId(isSelected ? null : subject.id)}
                  className={`border-b cursor-pointer group ${
                    isSelected
                      ? "border-blue-400 bg-blue-100/60"
                      : "border-gray-300 hover:bg-blue-50/30"
                  }`}
                >
                  <td className={`border-r px-2 py-1 text-[11px] font-semibold sticky left-0 z-10 ${
                    isSelected
                      ? "border-blue-300 bg-blue-100 text-blue-900"
                      : "border-gray-200 bg-white text-gray-900 group-hover:bg-blue-50/30"
                  }`}>
                    {subject.name}
                  </td>
                  {dates.map((date: string, dateIdx: number) => {
                    const grades = subject.gradesMatrix?.[dateIdx] || [];
                    const gradesCount = grades.length;

                    const getTooltipText = () => {
                      if (grades.length === 0) return "";
                      const types = grades.map((g) => (g.type && g.type.trim() ? g.type : null)).filter(Boolean);
                      if (types.length > 0) {
                        const uniqueTypes = [...new Set(types)];
                        return `${date} - ${uniqueTypes.join(", ")}`;
                      }
                      return date;
                    };

                    const getLayoutStyle = (): React.CSSProperties => {
                      if (gradesCount === 0) return {};
                      if (gradesCount === 1) {
                        return {
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: "100%",
                        };
                      } else if (gradesCount === 2) {
                        return {
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "1px",
                          height: "100%",
                        };
                      } else if (gradesCount === 3) {
                        return {
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gridTemplateRows: "1fr 1fr",
                          gap: "1px",
                          height: "100%",
                          padding: "1px",
                        };
                      } else {
                        return {
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gridTemplateRows: "1fr 1fr",
                          gap: "1px",
                          height: "100%",
                          padding: "1px",
                        };
                      }
                    };

                    return (
                      <td
                        key={dateIdx}
                        className={`border-r text-center align-middle cursor-help ${
                          isSelected
                            ? "border-blue-300 bg-blue-100/70"
                            : "border-gray-300 bg-yellow-50 group-hover:bg-blue-50/30"
                        }`}
                        style={{
                          minWidth: "24px",
                          minHeight: "24px",
                          maxWidth: "32px",
                          maxHeight: "32px",
                          width: "32px",
                          height: "32px",
                          padding: "2px",
                          boxSizing: "border-box",
                          overflow: "hidden",
                        }}
                        title={grades.length > 0 ? getTooltipText() : undefined}
                      >
                        {grades.length > 0 ? (
                          <div style={getLayoutStyle()}>
                            {grades.slice(0, 4).map((grade, gradeIdx) => {
                              if (gradesCount === 3 && gradeIdx === 2) {
                                return (
                                  <span
                                    key={gradeIdx}
                                    className="inline-flex items-center justify-center text-[9px] font-medium leading-none text-gray-900"
                                    style={{
                                      gridColumn: "1 / 3",
                                      ...journalMarkAlertStyle(grade.kind),
                                    }}
                                  >
                                    {grade.value}
                                  </span>
                                );
                              }
                              return (
                                <span
                                  key={gradeIdx}
                                  className="inline-flex items-center justify-center text-[9px] font-medium leading-none text-gray-900"
                                  style={journalMarkAlertStyle(grade.kind)}
                                >
                                  {grade.value}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className={`border-l-2 px-1.5 py-1 text-center font-bold text-[11px] ${
                    isSelected
                      ? "border-blue-400 bg-blue-200/60 text-blue-900"
                      : "border-gray-300 bg-gray-50 text-gray-900 group-hover:bg-blue-50/30"
                  }`}>
                    {subject.average}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Timetable section */}
        {timetableData && timetableData.pairs && timetableData.pairs.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3 px-1 gap-3 flex-wrap">
              <h2 className="text-lg font-medium text-gray-900">Расписание: {timetableData.groupName || "Группа"}</h2>
              <div className="flex items-center gap-3 flex-wrap">
                {!native && (
                  <button
                    type="button"
                    onClick={handleEnableNotifications}
                    disabled={notifLoading}
                    className="bg-[#3390ec] hover:bg-[#2d7fd6] disabled:bg-gray-400 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
                  >
                    {notifLoading ? "Создание..." : "Включить уведомления"}
                  </button>
                )}
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRemoved}
                    onChange={(e) => setShowRemoved(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="hidden sm:inline">{showRemoved ? "Показать отмененные пары" : "Показать замены"}</span>
                  <span className="sm:hidden">{showRemoved ? "Отмененные" : "Замены"}</span>
                </label>
              </div>
            </div>
            {(notifLink || notifError) && (
              <div className="mb-3 px-1">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col gap-2">
                  {notifError && <div className="text-red-600 text-sm">{notifError}</div>}
                  {notifLink && (
                    <>
                      <div className="text-sm text-gray-900">
                        Отправьте эту ссылку или токен боту @kbp_journal_bot, чтобы привязать уведомления.
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-gray-800">Ссылка:</span>{" "}
                        <a href={notifLink} className="text-blue-600 underline break-all" target="_blank" rel="noreferrer">
                          {notifLink}
                        </a>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-800">Токен:</span>
                        <span className="px-2 py-1 bg-white border border-gray-200 rounded">{notifToken}</span>
                        <button
                          type="button"
                          onClick={copyToken}
                          className="text-blue-600 hover:text-blue-700 text-xs font-medium"
                        >
                          {notifCopied ? "Скопировано" : "Копировать"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm bg-white">
              {(() => {
                const timetableDayCount = getTimetableDayCount(timetableData);
                const timetableDayLabels = getTimetableDayShortLabels(timetableData);
                const dayColWidth = `calc((100% - 40px) / ${timetableDayCount})`;
                return (
              <div
                className="overflow-x-auto overflow-y-hidden -webkit-overflow-scrolling-touch"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                <table className="w-full border-collapse text-sm" style={{ minWidth: `${520 + timetableDayCount * 80}px` }}>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="border-r border-gray-200 px-0 py-0 text-center font-semibold text-xs w-8 bg-orange-50">
                        <div className="h-20 flex items-center justify-center">
                          <span
                            className="text-[11px] font-semibold text-orange-600"
                            style={{ transform: "rotate(-90deg)", whiteSpace: "nowrap" }}
                          >
                            Сегодня
                          </span>
                        </div>
                      </th>
                      <th className="border-r border-gray-200 px-2 py-2 text-center font-semibold text-xs w-10 bg-gray-100">#</th>
                      {timetableDayLabels.map((dayLabel, dayIdx) => (
                      <th
                        key={dayIdx}
                        className="border-r border-gray-200 px-2 py-2 text-center font-semibold text-xs last:border-r-0"
                        style={{ width: dayColWidth }}
                      >
                        <div className="leading-tight">{dayLabel}</div>
                        <div className="text-[9px] font-semibold text-blue-600 mt-0.5">
                          {timetableData?.dayReplacementStatus?.[dayIdx]?.label || ""}
                        </div>
                        {timetableData?.dayStartTimes?.[dayIdx]?.start && (
                          <div className="text-[9px] font-normal text-gray-600 mt-0.5">
                            <div className="text-gray-500">Начало - Конец:</div>
                            <div>
                              {timetableData.dayStartTimes[dayIdx].start} - {timetableData.dayStartTimes[dayIdx].end}
                            </div>
                          </div>
                        )}
                      </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((pairNum) => {
                      const pairsForPair = timetableData.pairs?.filter((p: any) => p.pairNumber === pairNum) || [];
                      const pairsByDay: any[][] = Array.from({ length: timetableDayCount }, () => []);

                      pairsForPair.forEach((pair: any) => {
                        const slot = getTimetableDisplayDay(pair);
                        if (slot >= 0 && slot < timetableDayCount) {
                          pairsByDay[slot].push(pair);
                        }
                      });

                      if (pairsForPair.length === 0 && pairNum > 7) {
                        return null;
                      }

                      return (
                        <tr key={pairNum} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                          <td className="border-r border-gray-200 px-0 py-0 align-middle bg-orange-50/30" />
                          <td className="border-r border-gray-200 px-2 py-2 text-center font-semibold text-xs bg-gray-50/50 text-gray-600">
                            {pairNum}
                          </td>
                          {pairsByDay.map((pairs, dayIdx) => {
                            const filteredPairs = pairs.filter((p: any) => {
                              if (showRemoved) {
                                return p.status === "removed" || p.status === "cancelled";
                              }
                              return p.status === "added" || p.status === "replaced" || p.status === "normal";
                            });

                            const isCurrentPair =
                              currentPair &&
                              getTimetableDisplayDay(currentPair) === dayIdx &&
                              currentPair.pairNumber === pairNum;
                            const hasValidPair = filteredPairs.some((p: any) => {
                              if (!p.subject) return false;
                              const subjectTrimmed = p.subject.trim();
                              return subjectTrimmed !== "" && subjectTrimmed !== "Урок снят";
                            });

                            const getStatusColor = () => {
                              if (isCurrentPair && hasValidPair) return "bg-red-100 border-red-300";
                              if (filteredPairs.length === 0) return "";
                              if (filteredPairs.some((p: any) => p.status === "added")) return "bg-green-50 border-green-200";
                              if (filteredPairs.some((p: any) => p.status === "removed")) return "bg-red-50 border-red-200";
                              if (filteredPairs.some((p: any) => p.status === "replaced")) return "bg-yellow-50 border-yellow-200";
                              return "";
                            };

                            return (
                              <td
                                key={dayIdx}
                                className={`border-r border-gray-200 px-2 py-2 align-top ${getStatusColor()}`}
                                style={{ minHeight: "60px" }}
                              >
                                {filteredPairs.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {filteredPairs.map((pair: any, idx: number) => (
                                      <div
                                        key={idx}
                                        className={`text-xs rounded px-2 py-1.5 ${
                                          idx < pairs.length - 1 ? "mb-1.5 border-b border-gray-200/50" : ""
                                        } ${
                                          pair.status === "added"
                                            ? "bg-green-100/50"
                                            : pair.status === "removed"
                                            ? "bg-red-100/50"
                                            : pair.status === "replaced"
                                            ? "bg-yellow-100/50"
                                            : "bg-white/50"
                                        }`}
                                      >
                                        <div
                                          className="font-semibold text-gray-900 leading-tight mb-1 truncate text-sm"
                                          title={pair.subject}
                                        >
                                          {pair.subject}
                                        </div>
                                        {((pair.teacher && pair.teacher.trim()) || (pair.room && pair.room.trim())) && (
                                          <div className="text-[9px] text-gray-600 leading-tight mb-0.5 flex items-center gap-1.5 truncate">
                                            {pair.teacher && pair.teacher.trim() && (
                                              <span className="truncate" title={pair.teacher}>
                                                {pair.teacher}
                                              </span>
                                            )}
                                            {pair.teacher && pair.teacher.trim() && pair.room && pair.room.trim() && (
                                              <span className="text-gray-400">•</span>
                                            )}
                                            {pair.room && pair.room.trim() && (
                                              <span className="text-gray-500 font-medium whitespace-nowrap">{pair.room}</span>
                                            )}
                                          </div>
                                        )}
                                        {(() => {
                                          const subjectGrades = getSubjectGrades(pair.subject);
                                          if (subjectGrades) {
                                            const weekDayGrades = getGradesForWeekDay(subjectGrades, dayIdx);
                                            return (
                                              <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                                                {weekDayGrades.length > 0 && (
                                                  <div className="flex items-center gap-0.5">
                                                    {weekDayGrades.map((grade, gIdx) => (
                                                      <span
                                                        key={gIdx}
                                                        className={`inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded shadow-sm ${
                                                          grade.kind === "alert" ? "bg-red-100" : "bg-yellow-300 text-gray-900"
                                                        }`}
                                                        style={journalMarkAlertStyle(grade.kind)}
                                                        title={grade.type || "Оценка"}
                                                      >
                                                        {grade.value}
                                                      </span>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          }
                                          return null;
                                        })()}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="h-8"></div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
                );
              })()}
            <div className="mt-4 px-1">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Обозначения цветов:</h3>
                <div className="flex flex-wrap gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-green-100/50 border border-green-200 rounded"></div>
                    <span className="text-gray-700">Добавленные пары</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
                    <span className="text-gray-700">Текущая пара</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-yellow-100/50 border border-yellow-200 rounded"></div>
                    <span className="text-gray-700">Замененные пары</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-50 border border-red-200 rounded"></div>
                    <span className="text-gray-700">Снятые пары</span>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}