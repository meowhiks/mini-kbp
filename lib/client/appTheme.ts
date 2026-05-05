export type AppTheme = "light" | "dark" | "oled";

export function themeIsDark(theme: AppTheme): boolean {
  return theme === "dark" || theme === "oled";
}

/** Фон скролл-страниц (настройки / расписание / журнал) */
export function themePageBg(theme: AppTheme): string {
  if (theme === "light") return "bg-gray-50";
  if (theme === "oled") return "bg-black";
  return "bg-zinc-900";
}

/** Корневой контейнер приложения */
export function themeAppShell(theme: AppTheme): string {
  if (theme === "light") return "bg-gray-100 text-gray-900";
  if (theme === "oled") return "bg-black text-zinc-100";
  return "bg-zinc-900 text-zinc-100";
}
