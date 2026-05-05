/**
 * Официальное расписание звонков КБиП (пн–пт большинство дней, чт с 7-й пары, сб с 5-й).
 * dayIndex: 0 пн … 5 сб
 */

const STD: Record<number, { start: string; end: string }> = {
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
};

const THU_FROM7: Record<number, { start: string; end: string }> = {
  7: { start: "14.40", end: "15.25" },
  8: { start: "15.35", end: "16.20" },
  9: { start: "16.30", end: "17.15" },
  10: { start: "17.25", end: "18.10" },
  11: { start: "18.20", end: "19.05" },
  12: { start: "19.15", end: "20.00" },
  13: { start: "20.10", end: "20.55" },
};

const SAT_FROM5: Record<number, { start: string; end: string }> = {
  5: { start: "11.40", end: "12.25" },
  6: { start: "12.35", end: "13.20" },
  7: { start: "13.40", end: "14.25" },
  8: { start: "14.35", end: "15.20" },
  9: { start: "15.30", end: "16.15" },
  10: { start: "16.25", end: "17.10" },
  11: { start: "17.20", end: "18.05" },
  12: { start: "18.15", end: "19.00" },
  13: { start: "19.10", end: "19.55" },
};

export function getKbpPairTime(pairNumber: number, dayIndex: number): { start: string; end: string } {
  if (pairNumber < 1 || pairNumber > 13) return { start: "", end: "" };

  if (dayIndex === 3) {
    if (pairNumber >= 7) return THU_FROM7[pairNumber] || { start: "", end: "" };
    return STD[pairNumber];
  }

  if (dayIndex === 5) {
    if (pairNumber >= 5) return SAT_FROM5[pairNumber] || { start: "", end: "" };
    return STD[pairNumber];
  }

  return STD[pairNumber] || { start: "", end: "" };
}
