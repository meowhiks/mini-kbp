"use client";

import { useState, useEffect, useRef } from "react";
import { searchTimetable, fetchTimetableByCategory, forceRebuildSearchIndex, type SearchResult } from "@/lib/client/searchApi";
import { isNativeApp } from "@/lib/client/platform";
import { storageGet, storageSet } from "@/lib/client/storage";

interface TimetableSearchProps {
  onSelectResult?: (result: SearchResult, timetableData: any) => void;
}

const RECENT_SEARCHES_KEY = "recent_timetable_searches_v1";
const MAX_RECENT = 5;

export default function TimetableSearch({ onSelectResult }: TimetableSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [rebuildProgress, setRebuildProgress] = useState(0);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recentScrollRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // Load recent searches on mount
  useEffect(() => {
    const loadRecent = async () => {
      const saved = await storageGet(RECENT_SEARCHES_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setRecentSearches(parsed);
          }
        } catch {}
      }
    };
    loadRecent();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, []);

  useEffect(() => {
    const debounceTimer = setTimeout(async () => {
      if (query.trim().length >= 2) {
        setLoading(true);
        try {
          const searchResults = await searchTimetable(query);
          setResults(searchResults);
          setShowResults(true);
        } catch (err) {
          console.error("Search error:", err);
        } finally {
          setLoading(false);
        }
      } else {
        setResults([]);
        setShowResults(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [query]);

  const saveRecentSearch = async (result: SearchResult) => {
    const newRecent = [
      result,
      ...recentSearches.filter((r) => !(r.id === result.id && r.type === result.type)),
    ].slice(0, MAX_RECENT);
    setRecentSearches(newRecent);
    await storageSet(RECENT_SEARCHES_KEY, JSON.stringify(newRecent));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && results.length > 0 && !loading) {
      e.preventDefault();
      handleSelectResult(results[0]);
    }
  };

  const handleSelectResult = async (result: SearchResult) => {
    setSelectedResult(result);
    setShowResults(false);
    setQuery(result.name);

    // Save to recent searches
    await saveRecentSearch(result);

    try {
      const timetableResult = await fetchTimetableByCategory(result.type, result.id);
      if (timetableResult.success && timetableResult.data) {
        onSelectResult?.(result, timetableResult.data);
      }
    } catch (err) {
      console.error("Error fetching timetable:", err);
    }
  };

  const handleSelectFromRecent = async (result: SearchResult) => {
    setQuery(result.name);
    setShowResults(false);

    try {
      const timetableResult = await fetchTimetableByCategory(result.type, result.id);
      if (timetableResult.success && timetableResult.data) {
        onSelectResult?.(result, timetableResult.data);
      }
    } catch (err) {
      console.error("Error fetching timetable:", err);
    }
  };

  const removeFromRecent = async (e: React.MouseEvent, result: SearchResult) => {
    e.stopPropagation();
    const filtered = recentSearches.filter(
      (r) => !(r.id === result.id && r.type === result.type)
    );
    setRecentSearches(filtered);
    await storageSet(RECENT_SEARCHES_KEY, JSON.stringify(filtered));
  };

  // Long press handlers for search icon
  const startLongPress = () => {
    if (!isNativeApp()) return;

    setRebuildProgress(0);
    setIsRebuilding(true);

    progressInterval.current = setInterval(() => {
      setRebuildProgress((prev) => {
        if (prev >= 100) {
          if (progressInterval.current) clearInterval(progressInterval.current);
          return 100;
        }
        return prev + 3.33;
      });
    }, 100);

    longPressTimer.current = setTimeout(() => {
      triggerRebuild();
    }, 3000);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    setIsRebuilding(false);
    setRebuildProgress(0);
  };

  const triggerRebuild = async () => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    setRebuildProgress(100);

    const result = await forceRebuildSearchIndex();

    if (result.success) {
      alert(`Индекс обновлен! Загружено ${result.count} записей.`);
    } else {
      alert(`Ошибка обновления: ${result.error || "Неизвестная ошибка"}`);
    }

    setIsRebuilding(false);
    setRebuildProgress(0);
  };

  const highlight = (text: string, q: string) => {
    const needle = q.trim();
    if (!needle || needle.length < 2) return text;
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const hit = text.slice(idx, idx + needle.length);
    const after = text.slice(idx + needle.length);
    return (
      <>
        {before}
        <span className="bg-yellow-200 text-gray-900 rounded px-1">{hit}</span>
        {after}
      </>
    );
  };

  const typeLabel = (t: SearchResult["type"]) => {
    switch (t) {
      case "group":
        return "Группа";
      case "teacher":
        return "Преподаватель";
      case "place":
        return "Аудитория";
      case "subject":
        return "Предмет";
      default:
        return "Результат";
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setShowResults(true)}
          onKeyDown={handleKeyDown}
          placeholder="Поиск по группам, преподавателям, аудиториям..."
          className="w-full bg-white border border-gray-300 text-gray-900 placeholder-gray-400
                     focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                     text-base px-4 py-3 pr-20
                     transition-all duration-200"
          style={{ borderRadius: "5px" }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {query.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setShowResults(false);
                inputRef.current?.focus();
              }}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Очистить поиск"
              title="Очистить"
            >
              ×
            </button>
          )}
          {loading ? (
            <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          ) : (
            <button
              onMouseDown={startLongPress}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={startLongPress}
              onTouchEnd={cancelLongPress}
              className="relative"
              title={isNativeApp() ? "Удерживайте 3 сек для обновления базы" : "Поиск"}
            >
              <svg
                className="w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              {isRebuilding && (
                <svg className="absolute inset-0 w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" fill="none" stroke="#e5e7eb" strokeWidth="2" />
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    strokeDasharray={`${2 * Math.PI * 8}`}
                    strokeDashoffset={`${2 * Math.PI * 8 * (1 - rebuildProgress / 100)}`}
                    className="transition-all duration-100"
                  />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Recent Searches - Horizontal Scroll */}
      {recentSearches.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-2">Недавние:</div>
          <div
            ref={recentScrollRef}
            className="flex gap-2 overflow-x-auto scrollbar-hide pb-2"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {recentSearches.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => handleSelectFromRecent(result)}
                className="flex-shrink-0 flex items-center gap-2 bg-gray-50 hover:bg-gray-100
                           border border-gray-200 rounded-lg px-3 py-2 transition-colors"
              >
                <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  {result.name}
                </span>
                <span
                  onClick={(e) => removeFromRecent(e, result)}
                  className="ml-1 text-gray-400 hover:text-red-500 cursor-pointer text-lg leading-none"
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results Dropdown */}
      {showResults && results.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 shadow-lg z-50 max-h-80 overflow-y-auto"
          style={{ borderRadius: "5px" }}
        >
          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}-${index}`}
              onClick={() => handleSelectResult(result)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 border-b border-gray-100 last:border-b-0"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-gray-900 truncate">{highlight(result.name, query)}</div>
                  <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    {typeLabel(result.type)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No Results */}
      {showResults && query.trim().length >= 2 && !loading && results.length === 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 shadow-lg z-50 p-4 text-center text-gray-500"
          style={{ borderRadius: "5px" }}
        >
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
