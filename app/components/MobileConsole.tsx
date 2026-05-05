"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

type LogLevel = "log" | "info" | "warn" | "error";

type LogItem = {
  id: string;
  t: number;
  level: LogLevel;
  args: unknown[];
};

function safeStringify(x: unknown): string {
  try {
    if (typeof x === "string") return x;
    if (x instanceof Error) return `${x.name}: ${x.message}\n${x.stack || ""}`.trim();
    return JSON.stringify(x);
  } catch {
    try {
      return String(x);
    } catch {
      return "[unprintable]";
    }
  }
}

function formatLine(item: LogItem): string {
  const ts = new Date(item.t).toLocaleTimeString();
  const parts = item.args.map((a) => safeStringify(a));
  return `[${ts}] ${item.level.toUpperCase()} ${parts.join(" ")}`.trim();
}

function isMobileLike(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

export default function MobileConsole() {
  const enabledByDefault = useMemo(() => {
    try {
      return Capacitor.isNativePlatform() || isMobileLike();
    } catch {
      return isMobileLike();
    }
  }, []);

  const [enabled, setEnabled] = useState(enabledByDefault);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LogItem[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const push = (level: LogLevel, args: unknown[]) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setItems((prev) => {
        const next = prev.length > 600 ? prev.slice(prev.length - 500) : prev;
        return [...next, { id, t: Date.now(), level, args }];
      });
    };

    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    } as const;

    console.log = (...args: unknown[]) => {
      push("log", args);
      original.log(...args);
    };
    console.info = (...args: unknown[]) => {
      push("info", args);
      original.info(...args);
    };
    console.warn = (...args: unknown[]) => {
      push("warn", args);
      original.warn(...args);
    };
    console.error = (...args: unknown[]) => {
      push("error", args);
      original.error(...args);
    };

    const onError = (ev: ErrorEvent) => {
      push("error", [ev.message, ev.error || { filename: ev.filename, lineno: ev.lineno, colno: ev.colno }]);
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      push("error", ["unhandledrejection", ev.reason]);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    const origFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") || "GET").toUpperCase();
      push("info", ["[fetch]", method, url]);
      try {
        const res = await origFetch(input as any, init);
        push("info", ["[fetch]", method, url, "->", res.status]);
        return res;
      } catch (e) {
        push("error", ["[fetch]", method, url, "FAILED", e]);
        throw e;
      }
    };

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      window.fetch = origFetch;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items, open]);

  if (!enabled) return null;

  const copyAll = async () => {
    const text = items.map(formatLine).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      console.log("[MobileConsole] copied", text.length, "chars");
    } catch (e) {
      console.error("[MobileConsole] copy failed", e);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-[9999] rounded-full bg-black/80 text-white text-xs px-3 py-2 shadow-lg"
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {open ? "Close logs" : "Logs"}
      </button>

      {open && (
        <div className="fixed inset-x-2 bottom-14 z-[9999] max-h-[60vh] rounded-xl border border-black/20 bg-white shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-black/10 bg-gray-50">
            <div className="text-xs font-semibold text-gray-800">Console</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyAll}
                className="text-xs px-2 py-1 rounded bg-white border border-gray-200"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setItems([])}
                className="text-xs px-2 py-1 rounded bg-white border border-gray-200"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs px-2 py-1 rounded bg-white border border-gray-200"
              >
                Hide
              </button>
            </div>
          </div>

          <div ref={listRef} className="custom-scrollbar overflow-auto px-3 py-2 text-[11px] leading-snug font-mono">
            {items.length === 0 ? (
              <div className="text-gray-500">No logs yet.</div>
            ) : (
              items.map((it) => {
                const color =
                  it.level === "error"
                    ? "text-red-700"
                    : it.level === "warn"
                      ? "text-yellow-800"
                      : it.level === "info"
                        ? "text-blue-800"
                        : "text-gray-800";
                return (
                  <div key={it.id} className={`whitespace-pre-wrap break-words ${color}`}>
                    {formatLine(it)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}

