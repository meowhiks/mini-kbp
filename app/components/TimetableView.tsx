"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getKbpPairTime } from "@/lib/client/kbpBellSchedule";
import {
  getTimetableDayCount,
  getTimetableDayLabels,
  getTimetableDayShortLabels,
  normalizeTimetableData,
  pairMatchesDisplayDay,
  TIMETABLE_SLOT_NEXT_MONDAY,
} from "@/lib/client/timetableDisplay";

interface Pair {
  pairNumber: number;
  day: number;
  weekOffset?: number;
  dayName: string;
  subject: string;
  teacher: string;
  room: string;
  group?: string;
  refs?: {
    subject?: { id: string; name: string };
    place?: { id: string; name: string };
    group?: { id: string; name: string };
    teachers?: Array<{ id: string; name: string }>;
  };
  status: string;
}

interface TimetableViewProps {
  data: any;
  title?: string;
  subtitle?: string;
  onNavigateEntity?: (type: "group" | "teacher" | "place" | "subject", id: string, name: string) => void;
  countdownEnabled?: boolean;
  defaultShowReplacements?: boolean;
  density?: "normal" | "compact" | "small";
  /** Не показывать блок преподаватель / аудитория */
  hideTeacherRoom?: boolean;
  /** Не показывать номер пары слева */
  hidePairNumbers?: boolean;
  /** Полоска быстрого выбора дня (Пн–Сб, след. понедельник) */
  showDayStrip?: boolean;
}

export default function TimetableView({
  data,
  title,
  subtitle,
  onNavigateEntity,
  countdownEnabled,
  defaultShowReplacements,
  density,
  hideTeacherRoom = false,
  hidePairNumbers = false,
  showDayStrip = false,
}: TimetableViewProps) {
  const defaultReplacement = defaultShowReplacements ?? true;
  const densityMode: "normal" | "compact" | "small" = density ?? "normal";

  const [showReplacementsDays, setShowReplacementsDays] = useState<boolean[]>(() =>
    Array(7).fill(defaultReplacement)
  );
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const today = new Date().getDay();
  const currentDayIndex = today === 0 ? 6 : today - 1;
  const initialDayIndex = currentDayIndex >= 0 && currentDayIndex <= 5 ? currentDayIndex : 0;
  const [visibleDayIndex, setVisibleDayIndex] = useState(initialDayIndex);
  const [dayAnim, setDayAnim] = useState<"" | "timetable-day-in-r" | "timetable-day-in-l">("");
  const prevDayRef = useRef(visibleDayIndex);

  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!countdownEnabled) return;
    const id = window.setInterval(() => setNowTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [countdownEnabled]);

  useEffect(() => {
    setVisibleDayIndex(initialDayIndex);
  }, [initialDayIndex]);

  const timetable = useMemo(() => normalizeTimetableData(data), [data]);
  const hasData = Boolean(timetable?.pairs?.length);
  const weekDays = useMemo(() => (hasData ? getTimetableDayLabels(timetable) : []), [timetable, hasData]);
  const dayShortLabels = useMemo(() => (hasData ? getTimetableDayShortLabels(timetable) : []), [timetable, hasData]);
  const dayCount = hasData ? getTimetableDayCount(timetable) : 6;
  const maxDayIndex = dayCount - 1;

  useEffect(() => {
    setVisibleDayIndex((prev) => Math.min(prev, maxDayIndex));
  }, [maxDayIndex, hasData]);

  useEffect(() => {
    if (prevDayRef.current === visibleDayIndex) return;
    setDayAnim(visibleDayIndex > prevDayRef.current ? "timetable-day-in-r" : "timetable-day-in-l");
    prevDayRef.current = visibleDayIndex;
    const id = window.setTimeout(() => setDayAnim(""), 340);
    return () => window.clearTimeout(id);
  }, [visibleDayIndex]);

  // Set replacement toggle defaults based on parsed "замены" row.
  useEffect(() => {
    const statuses = timetable?.dayReplacementStatus;
    if (!Array.isArray(statuses) || statuses.length < 6) return;

    setShowReplacementsDays((prev) => {
      const len = Math.max(7, statuses.length);
      return Array.from({ length: len }, (_, idx) => {
        const info = statuses[idx];
        if (info?.hasChanges) return defaultReplacement;
        if (info?.noChanges) return false;
        return prev[idx] ?? defaultReplacement;
      });
    });
  }, [timetable?.dayReplacementStatus, defaultReplacement]);

  const goPrevDay = () => setVisibleDayIndex((prev) => Math.max(0, prev - 1));
  const goNextDay = () => setVisibleDayIndex((prev) => Math.min(maxDayIndex, prev + 1));

  if (!hasData) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-zinc-400">
        <p>Нет данных для отображения</p>
      </div>
    );
  }

  const visibleDayName = weekDays[visibleDayIndex] ?? weekDays[0];
  const visibleIsToday = visibleDayIndex === currentDayIndex;

  const dayHeaderPadding =
    densityMode === "small" ? "px-2 py-2" : densityMode === "compact" ? "px-3 py-2" : "px-4 py-3";
  const pairPadding = densityMode === "small" ? "p-2" : densityMode === "compact" ? "p-3" : "p-4";
  const pairNumberClass =
    densityMode === "small" ? "text-base w-5" : densityMode === "compact" ? "text-lg w-6" : "text-lg w-6";

  const formatBellClock = (t: string): string => {
    const raw = (t || "").trim();
    if (!raw) return "";
    const [hRaw, mRaw = "0"] = raw.split(/[.:]/).map((x) => x.trim());
    const h = Number(hRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return raw;
    return `${h}:${String(m).padStart(2, "0")}`;
  };

  const timeToMinutes = (t: string): number | null => {
    const s = (t || "").trim();
    if (!s) return null;
    const parts = s.split(/[.:]/).map((x) => x.trim());
    const h = Number(parts[0]);
    const m = Number(parts[1] || "0");
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };

  const nowMinutes = (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  const isLiveCalendarDay = (dayIndex: number) => dayIndex === currentDayIndex;

  const bellDayIndex = (dayIndex: number) => (dayIndex === TIMETABLE_SLOT_NEXT_MONDAY ? 0 : dayIndex);

  const getNowHighlightedPairNumber = (dayIndex: number, pairs: Pair[]): number | null => {
    if (!isLiveCalendarDay(dayIndex)) return null;
    if (pairs.length === 0) return null;

    // 1) exact current pair
    for (const p of pairs) {
      const { start, end } = getKbpPairTime(p.pairNumber, bellDayIndex(dayIndex));
      const s = timeToMinutes(start);
      const e = timeToMinutes(end);
      if (s === null || e === null) continue;
      if (nowMinutes >= s && nowMinutes < e) return p.pairNumber;
    }

    return null;
  };

  const formatCountdown = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    if (h > 0) return `${h}:${mm}:${ss}`;
    return `${m}:${ss}`;
  };

  const getCountdownParen = (pairNumber: number, dayIndex: number): string | null => {
    if (!countdownEnabled || !isLiveCalendarDay(dayIndex)) return null;
    const { start, end } = getKbpPairTime(pairNumber, bellDayIndex(dayIndex));
    const sMin = timeToMinutes(start);
    const eMin = timeToMinutes(end);
    if (sMin === null || eMin === null) return null;

    const now = nowTickMs;
    const base = new Date();

    const sDate = new Date(base);
    sDate.setHours(Math.floor(sMin / 60), sMin % 60, 0, 0);
    const eDate = new Date(base);
    eDate.setHours(Math.floor(eMin / 60), eMin % 60, 0, 0);

    if (now < sDate.getTime()) return formatCountdown(sDate.getTime() - now);
    if (now < eDate.getTime()) return formatCountdown(eDate.getTime() - now);
    return null;
  };

  const getNextHighlightedPairNumber = (dayIndex: number, pairs: Pair[]): number | null => {
    if (!isLiveCalendarDay(dayIndex)) return null;
    if (pairs.length === 0) return null;

    // nearest upcoming pair
    let best: { pairNumber: number; start: number } | null = null;
    for (const p of pairs) {
      const { start } = getKbpPairTime(p.pairNumber, bellDayIndex(dayIndex));
      const s = timeToMinutes(start);
      if (s === null) continue;
      if (s > nowMinutes && (!best || s < best.start)) best = { pairNumber: p.pairNumber, start: s };
    }
    return best?.pairNumber ?? null;
  };

  const getPairsForDay = (dayIndex: number): Pair[] => {
    const showReplacements = showReplacementsDays[dayIndex];
    const dayPairs = timetable.pairs
      .filter((p: Pair) => pairMatchesDisplayDay(p, dayIndex))
      .filter((p: Pair) => {
        if (showReplacements) return p.status === "added" || p.status === "replaced" || p.status === "normal" || !p.status;
        return p.status === "removed" || p.status === "cancelled" || p.status === "replaced" || p.status === "normal" || !p.status;
      })
      .sort((a: Pair, b: Pair) => a.pairNumber - b.pairNumber);

    if (showReplacements) return dayPairs;

    // Hide ONLY added pairs, show cancelled if present, keep normal/replaced unchanged.
    const byPairNumber = new Map<number, Pair[]>();
    for (const pair of dayPairs) {
      if (!byPairNumber.has(pair.pairNumber)) byPairNumber.set(pair.pairNumber, []);
      byPairNumber.get(pair.pairNumber)!.push(pair);
    }

    const merged: Pair[] = [];
    for (const pairNumber of Array.from(byPairNumber.keys()).sort((a, b) => a - b)) {
      const bucket = byPairNumber.get(pairNumber)!;
      const cancelled = bucket.find((p) => p.status === "removed" || p.status === "cancelled");
      const replaced = bucket.find((p) => p.status === "replaced");
      const normal = bucket.find((p) => p.status === "normal" || !p.status);
      const added = bucket.find((p) => p.status === "added");

      if (cancelled) {
        merged.push(cancelled);
      } else if (normal) {
        merged.push(normal);
      } else if (replaced) {
        merged.push(replaced);
      } else if (added) {
        // Added exists without cancelled -> show empty slot
        merged.push({
          ...added,
          subject: "",
          teacher: "",
          room: "",
          status: "empty",
        });
      }
    }
    return merged;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "added":
        return "bg-green-50 border-green-300 dark:bg-green-900/35 dark:border-green-700/60";
      case "removed":
      case "cancelled":
        return "bg-red-100 border-red-500 text-red-900 dark:bg-red-900/35 dark:border-red-700/60 dark:text-red-200";
      case "replaced":
        return "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700/60";
      case "empty":
        return "bg-white border-gray-200 dark:bg-zinc-900 dark:border-zinc-700";
      default:
        return "bg-white border-gray-200 dark:bg-zinc-900 dark:border-zinc-700";
    }
  };

  return (
    <div className="pb-20">
      {/* Header */}
      {(title || subtitle) && (
        <div className="sticky top-0 bg-gray-50 dark:bg-zinc-900 z-10 px-4 py-3 border-b border-gray-200 dark:border-zinc-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              {title && <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100">{title}</h2>}
              {subtitle && <p className="text-sm text-gray-500 dark:text-zinc-400">{subtitle}</p>}
            </div>
            {!showDayStrip ? (
              <div className="text-right">
                <div className={`text-[11px] font-semibold ${visibleIsToday ? "text-blue-700 dark:text-blue-300" : "text-gray-700 dark:text-zinc-200"}`}>
                  {visibleDayName}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showDayStrip ? (
      <div className="px-2 pt-2 pb-1 flex items-center gap-1">
        <button
          type="button"
          onClick={goPrevDay}
          disabled={visibleDayIndex <= 0}
          className="shrink-0 w-8 h-8 rounded-lg border border-gray-200 dark:border-zinc-600 text-gray-700 dark:text-zinc-200 disabled:opacity-30"
          aria-label="Предыдущий день"
        >
          ‹
        </button>
        <div className="flex-1 flex gap-1 overflow-x-auto pb-0.5">
          {dayShortLabels.map((label, idx) => {
            const active = visibleDayIndex === idx;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setVisibleDayIndex(idx)}
                className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border ${
                  active
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={goNextDay}
          disabled={visibleDayIndex >= maxDayIndex}
          className="shrink-0 w-8 h-8 rounded-lg border border-gray-200 dark:border-zinc-600 text-gray-700 dark:text-zinc-200 disabled:opacity-30"
          aria-label="Следующий день"
        >
          ›
        </button>
      </div>
      ) : null}

      {/* Single day view with horizontal swipe */}
      <div className="space-y-3 px-1 pt-1">
        {(() => {
          const dayIndex = visibleDayIndex;
          const day = weekDays[dayIndex];
          const pairs = getPairsForDay(dayIndex);
          const showTodayChrome = dayIndex === currentDayIndex;
          const showReplacements = showReplacementsDays[dayIndex];
          const highlightedPairNumber = getNowHighlightedPairNumber(dayIndex, pairs);
          const nextHighlightedPairNumber = getNextHighlightedPairNumber(dayIndex, pairs);
          const replacementInfo = timetable?.dayReplacementStatus?.[dayIndex];
          const replacementLabel = replacementInfo?.label?.trim() || "";
          const dayRange = timetable?.dayStartTimes?.[dayIndex];
          const dayPairsForRange = (timetable?.pairs || [])
            .filter((p: Pair) => pairMatchesDisplayDay(p, dayIndex))
            .filter((p: Pair) => {
              const subjectTrimmed = (p.subject || "").trim();
              if (!subjectTrimmed || subjectTrimmed === "Урок снят") return false;
              if (p.status === "removed" || p.status === "cancelled") return false;
              return true;
            })
            .sort((a: Pair, b: Pair) => a.pairNumber - b.pairNumber);
          const fallbackStart = dayPairsForRange[0]
            ? getKbpPairTime(dayPairsForRange[0].pairNumber, bellDayIndex(dayIndex)).start
            : "";
          const fallbackEnd = dayPairsForRange[dayPairsForRange.length - 1]
            ? getKbpPairTime(dayPairsForRange[dayPairsForRange.length - 1].pairNumber, bellDayIndex(dayIndex)).end
            : "";
          const dayRangeText =
            dayRange?.start && dayRange?.end
              ? `${dayRange.start} - ${dayRange.end}`
              : fallbackStart && fallbackEnd
              ? `${fallbackStart} - ${fallbackEnd}`
              : "—";

          return (
            <div
              key={day}
              className={`relative bg-white dark:bg-zinc-900 rounded-[1px] overflow-visible border border-transparent dark:border-zinc-700 ${
                showTodayChrome ? "ring-2 ring-blue-300" : ""
              }`}
              style={{ touchAction: "pan-y" }}
              onTouchStart={(e) => {
                e.stopPropagation();
                const t = e.touches[0];
                if (!t) return;
                touchStartRef.current = { x: t.clientX, y: t.clientY };
              }}
              onTouchCancel={() => {
                touchStartRef.current = null;
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                const start = touchStartRef.current;
                touchStartRef.current = null;
                if (!start) return;
                const t = e.changedTouches[0];
                if (!t) return;
                const dx = t.clientX - start.x;
                const dy = t.clientY - start.y;
                const threshold = Math.max(40, Math.round(window.innerWidth * 0.1));
                if (Math.abs(dx) < threshold) return;
                if (Math.abs(dy) > Math.abs(dx) * 0.75) return;
                if (dx < 0) goNextDay();
                else goPrevDay();
              }}
            >
              <div className={dayAnim} style={{ willChange: "transform" }}>
              {/* Day Header */}
              <div className={`${dayHeaderPadding} font-semibold flex items-center justify-between ${
                showTodayChrome
                  ? "bg-blue-50 text-blue-900 dark:bg-blue-900/35 dark:text-blue-200"
                  : "bg-gray-100 text-gray-800 dark:bg-zinc-800 dark:text-zinc-100"
              }`}>
                <div>
                  {!showDayStrip ? <span>{day}</span> : null}
                  {replacementLabel ? (
                  <div className="text-[11px] text-blue-700 dark:text-blue-300/80 font-medium">
                    {replacementLabel}
                  </div>
                  ) : null}
                  {replacementInfo?.hasChanges && (
                    <label className="inline-flex items-center gap-1 mt-1 text-[11px] text-gray-700 dark:text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showReplacements}
                        onChange={(e) =>
                          setShowReplacementsDays((prev) => {
                            const next = [...prev];
                            next[dayIndex] = e.target.checked;
                            return next;
                          })
                        }
                        className="w-3.5 h-3.5 text-blue-500 border-gray-300 rounded"
                      />
                      <span>Показать замены</span>
                    </label>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-gray-700 dark:text-zinc-200">{dayRangeText}</div>
                  {showTodayChrome && (
                    <span className="text-xs bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 px-2 py-1 rounded-full">Сегодня</span>
                  )}
                </div>
              </div>

              {/* Pairs */}
              <div className="divide-y divide-gray-100 dark:divide-zinc-700 min-h-12">
                {pairs.length === 0 && (
                  <div className="px-4 py-3 text-sm text-gray-500 dark:text-zinc-400">Пар нет</div>
                )}
                {pairs.map((pair, idx) => (
                  (() => {
                    const isNow = highlightedPairNumber === pair.pairNumber;
                    const isNext = nextHighlightedPairNumber === pair.pairNumber;
                    return (
                  <div
                    key={idx}
                    className={`relative ${pairPadding} border-l-4 ${getStatusColor(pair.status)} ${isNow || isNext ? "pl-12" : ""}`}
                  >
                    {isNow && (
                      <div className="absolute left-0 top-0 bottom-0 w-8 bg-orange-100 dark:bg-orange-500/10 border-r border-orange-300 dark:border-orange-500/30 flex items-center justify-center">
                        <span
                          className="text-[11px] font-bold text-orange-800 dark:text-orange-300/80 tracking-wide"
                          style={{ transform: "rotate(-90deg)" }}
                        >
                          Сейчас
                        </span>
                      </div>
                    )}
                    {isNext && (
                      <div className="absolute left-0 top-0 bottom-0 w-8 bg-blue-50 dark:bg-blue-500/10 border-r border-blue-300 dark:border-blue-500/30 flex items-center justify-center">
                        <span
                          className="text-[11px] font-bold text-blue-800 dark:text-blue-300/80 tracking-wide"
                          style={{ transform: "rotate(-90deg)" }}
                        >
                          Ближ.
                        </span>
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div className={`flex items-start ${hidePairNumbers ? "gap-0" : "gap-3"}`}>
                        {!hidePairNumbers ? (
                          <span className={`font-bold text-gray-700 dark:text-zinc-200 ${pairNumberClass} text-center`}>
                            {pair.pairNumber}
                          </span>
                        ) : null}
                        <div className={hidePairNumbers ? "min-w-0 flex-1" : ""}>
                          <div className="text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
                            {(() => {
                              const pairTime = getKbpPairTime(pair.pairNumber, bellDayIndex(dayIndex));
                              const range =
                                pairTime.start && pairTime.end
                                  ? `${formatBellClock(pairTime.start)} - ${formatBellClock(pairTime.end)}`
                                  : "—";
                              const cd = getCountdownParen(pair.pairNumber, dayIndex);
                              return cd ? `${range} (${cd})` : range;
                            })()}
                          </div>
                          <div className="font-medium text-gray-900 dark:text-zinc-50">
                            {pair.subject && onNavigateEntity ? (
                              <button
                                type="button"
                                className="no-underline"
                                onClick={() => onNavigateEntity("subject", pair.refs?.subject?.id || "", pair.subject)}
                              >
                                {pair.subject || " "}
                              </button>
                            ) : (
                              pair.subject || " "
                            )}
                          </div>
                          {!hideTeacherRoom ? (
                          <div className="flex flex-wrap gap-2 mt-1 text-sm text-gray-600 dark:text-zinc-300">
                            {pair.group && (
                              onNavigateEntity ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white no-underline"
                                  onClick={() => onNavigateEntity("group", pair.refs?.group?.id || "", pair.group || pair.refs?.group?.name || "")}
                                >
                                  {pair.group}
                                </button>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                                  {pair.group}
                                </span>
                              )
                            )}
                            {pair.teacher && (
                              <span className="flex items-center gap-1">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                {onNavigateEntity ? (
                                  <button
                                    type="button"
                                    className="no-underline"
                                    onClick={() =>
                                      onNavigateEntity(
                                        "teacher",
                                        pair.refs?.teachers?.[0]?.id || "",
                                        pair.refs?.teachers?.[0]?.name || pair.teacher.split(",")[0]?.trim() || pair.teacher
                                      )
                                    }
                                  >
                                    {pair.teacher}
                                  </button>
                                ) : (
                                  pair.teacher
                                )}
                              </span>
                            )}
                            {pair.room && (
                              <span className="flex items-center gap-1">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                {onNavigateEntity ? (
                                  <button
                                    type="button"
                                    className="no-underline"
                                    onClick={() => onNavigateEntity("place", pair.refs?.place?.id || "", pair.room)}
                                  >
                                    ауд. {pair.room}
                                  </button>
                                ) : (
                                  <>ауд. {pair.room}</>
                                )}
                              </span>
                            )}
                          </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                    );
                  })()
                ))}
              </div>
              </div>
            </div>
          );
        })()}
      </div>

    </div>
  );
}
