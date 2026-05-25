/** Парсит числовую оценку из ячейки журнала (8, 8.5, 8,5). Буквы (н, б) — null. */
export function parseJournalMarkValue(raw: unknown): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!s || s === "-" || s === "—") return null;
  if (/^[а-яёА-ЯЁa-zA-Z]/u.test(s)) return null;
  const normalized = s.replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}

export function collectSubjectMarkValues(subject: {
  gradesMatrix?: Record<string | number, Array<{ value?: string }>>;
}): number[] {
  const values: number[] = [];
  const matrix = subject.gradesMatrix || {};
  for (const key of Object.keys(matrix)) {
    const grades = matrix[Number(key)] ?? matrix[key as keyof typeof matrix];
    if (!Array.isArray(grades)) continue;
    for (const g of grades) {
      const n = parseJournalMarkValue(g?.value);
      if (n !== null) values.push(n);
    }
  }
  return values;
}

/** Средний балл предмета: только из оценок в gradesMatrix, без строки с сайта. */
export function calcSubjectAverageFromMarks(subject: {
  gradesMatrix?: Record<string | number, Array<{ value?: string }>>;
}): number | null {
  const values = collectSubjectMarkValues(subject);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function formatComputedAverage(value: number | null, hundredths: boolean): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (hundredths) {
    return (Math.round(value * 100) / 100).toFixed(2);
  }
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function calcTotalAverageFromSubjects(
  subjects: Array<{ gradesMatrix?: Record<string | number, Array<{ value?: string }>> }>,
  hundredths: boolean
): string | null {
  const avgs = subjects
    .map((s) => calcSubjectAverageFromMarks(s))
    .filter((n): n is number => n !== null);
  if (avgs.length === 0) return null;
  const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
  return formatComputedAverage(mean, hundredths);
}
