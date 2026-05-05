"use client";

import { useEffect } from "react";

export default function ThemeScript() {
  useEffect(() => {
    // Проверяем сохранённую тему и применяем её сразу, до рендера
    const isDark = localStorage.getItem("darkMode") === "true";
    const html = document.documentElement;
    
    if (isDark) {
      html.classList.add("dark");
      html.style.colorScheme = "dark";
    } else {
      html.classList.remove("dark");
      html.style.colorScheme = "light";
    }
  }, []);

  return null;
}

