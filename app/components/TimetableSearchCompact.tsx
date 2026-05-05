"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  searchTimetable,
  fetchTimetableByCategory,
  listTimetableEntities,
  forceRebuildSearchIndex,
  type SearchResult,
} from "@/lib/client/searchApi";
import { storageGet, storageSet } from "@/lib/client/storage";
import { isNativeApp } from "@/lib/client/platform";

interface TimetableSearchCompactProps {
  onSelectResult?: (result: SearchResult, timetableData: any) => void;
}

const RECENT_SEARCHES_KEY = "recent_timetable_searches_v1";
const MAX_RECENT = 5;

export default function TimetableSearchCompact({ onSelectResult }: TimetableSearchCompactProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [allResults, setAllResults] = useState<SearchResult[]>([]);
  const [displayLimit, setDisplayLimit] = useState(80);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);
  const [rebuildProgress, setRebuildProgress] = useState(0);
  const [isRebuilding, setIsRebuilding] = useState(false);
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

  // Handle click outside
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

  // Debounced search
  const debouncedSearch = useCallback(
    async (searchQuery: string) => {
      if (searchQuery.trim().length < 1) {
        setResults(allResults.slice(0, displayLimit));
        setShowResults(true);
        return;
      }

      setLoading(true);
      try {
        const searchResults = await searchTimetable(searchQuery);
        const normalizedQuery = searchQuery.trim().toLowerCase();
        const sorted = searchResults.sort((a, b) => {
          const aStarts = a.name.toLowerCase().startsWith(normalizedQuery);
          const bStarts = b.name.toLowerCase().startsWith(normalizedQuery);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return a.name.localeCompare(b.name, "ru");
        });
        setResults(sorted);
        setShowResults(true);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    },
    [allResults, displayLimit]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      debouncedSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, debouncedSearch]);

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
      const items = await listTimetableEntities();
      setAllResults(items);
      setResults(items.slice(0, displayLimit));
      setShowResults(true);
      alert(`Индекс обновлен! Загружено ${result.count} записей.`);
    } else {
      alert(`Ошибка обновления: ${result.error || "Неизвестная ошибка"}`);
    }

    setIsRebuilding(false);
    setRebuildProgress(0);
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
          onFocus={() => {
            setShowResults(true);
            if (!query.trim() && allResults.length === 0) {
              setLoading(true);
              listTimetableEntities()
                .then((items) => {
                  setAllResults(items);
                  setDisplayLimit(120);
                  setResults(items.slice(0, 120));
                })
                .catch((err) => console.error("Index load error:", err))
                .finally(() => setLoading(false));
            } else if (!query.trim()) {
              setResults(allResults.slice(0, displayLimit));
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Найдите расписание"
          className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-zinc-200 placeholder-gray-400 dark:placeholder-zinc-500
                     focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-900
                     text-base px-4 py-3 pr-10 rounded-xl
                     transition-all duration-200"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
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
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
          <div className="text-xs text-gray-500 dark:text-zinc-400 mb-2">Недавние:</div>
          <div
            ref={recentScrollRef}
            className="flex gap-2 overflow-x-auto scrollbar-hide pb-2"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {recentSearches.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => handleSelectFromRecent(result)}
                className="flex-shrink-0 flex items-center gap-2 bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800
                           border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 transition-colors"
              >
                <span className="text-sm font-medium text-gray-700 dark:text-zinc-200 whitespace-nowrap">
                  {result.name}
                </span>
                <span
                  onClick={(e) => removeFromRecent(e, result)}
                  className="ml-1 text-gray-400 dark:text-zinc-500 hover:text-red-500 cursor-pointer text-lg leading-none"
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
          className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-lg rounded-xl z-50 max-h-80 overflow-y-auto"
          onScroll={(e) => {
            if (query.trim()) return;
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
              setDisplayLimit((prev) => {
                const next = Math.min(allResults.length || prev + 200, prev + 200);
                if (next !== prev) setResults(allResults.slice(0, next));
                return next;
              });
            }
          }}
        >
          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}-${index}`}
              onClick={() => handleSelectResult(result)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-3 border-b border-gray-100 dark:border-zinc-700 last:border-b-0"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-zinc-100 truncate">{result.name}</div>
              </div>
            </button>
          ))}
          {!query.trim() && allResults.length > 0 && results.length < allResults.length && (
            <div className="px-4 py-3 text-center text-xs text-gray-400 dark:text-zinc-500">
              Показано {results.length} из {allResults.length}. Листай вниз…
            </div>
          )}
        </div>
      )}

      {/* No Results */}
      {showResults && query.trim().length >= 1 && !loading && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 shadow-lg rounded-xl z-50 p-4 text-center text-gray-500">
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
