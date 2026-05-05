"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TimetableSearch from "../components/TimetableSearch";
import { SearchResult } from "@/lib/client/searchApi";

interface Pair {
  pairNumber: number;
  day: number;
  dayName: string;
  subject: string;
  teacher: string;
  room: string;
  status: string;
}

export default function TimetablePage() {
  const router = useRouter();
  const [timetableData, setTimetableData] = useState<any>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelectResult = async (result: SearchResult, data: any) => {
    setLoading(true);
    setSelectedResult(result);
    setTimetableData(data);
    setLoading(false);
  };

  const weekDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

  const getPairsForDay = (dayIndex: number): Pair[] => {
    if (!timetableData?.pairs) return [];
    return timetableData.pairs
      .filter((p: Pair) => p.day === dayIndex)
      .sort((a: Pair, b: Pair) => a.pairNumber - b.pairNumber);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "added":
        return "bg-green-50 border-green-200";
      case "removed":
      case "cancelled":
        return "bg-red-50 border-red-200 opacity-50";
      case "replaced":
        return "bg-yellow-50 border-yellow-200";
      default:
        return "bg-white border-gray-200";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "added":
        return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">добавлено</span>;
      case "removed":
      case "cancelled":
        return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">отменено</span>;
      case "replaced":
        return <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">замена</span>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => router.push("/")}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-gray-900">Расписание</h1>
          </div>

          <TimetableSearch onSelectResult={handleSelectResult} />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading && (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-500">Загрузка расписания...</p>
          </div>
        )}

        {!loading && !timetableData && (
          <div className="text-center py-12 text-gray-500">
            <div className="text-6xl mb-4"> </div>
            <p className="text-lg mb-2">Введите запрос для поиска</p>
            <p className="text-sm">Например: П-591, Янушкевич, 319</p>
          </div>
        )}

        {!loading && timetableData && (
          <div>
            {/* Title */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                {selectedResult?.name || timetableData.title || "Расписание"}
              </h2>
              {selectedResult && (
                <span className="inline-block mt-2 text-sm bg-blue-100 text-blue-700 px-3 py-1 rounded-full capitalize">
                  {selectedResult.typeLabel}
                </span>
              )}
            </div>

            {/* Schedule by days */}
            <div className="space-y-6">
              {weekDays.map((day, dayIndex) => {
                const pairs = getPairsForDay(dayIndex);
                if (pairs.length === 0) return null;

                return (
                  <div key={day} className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="bg-gray-100 px-4 py-3 font-semibold text-gray-800">
                      {day}
                    </div>
                    <div className="divide-y divide-gray-100">
                      {pairs.map((pair, idx) => (
                        <div
                          key={idx}
                          className={`p-4 border-l-4 ${
                            pair.status === "added"
                              ? "border-green-400"
                              : pair.status === "removed" || pair.status === "cancelled"
                              ? "border-red-400"
                              : pair.status === "replaced"
                              ? "border-yellow-400"
                              : "border-blue-400"
                          } ${getStatusColor(pair.status)}`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-lg text-gray-700 w-8">
                                {pair.pairNumber}
                              </span>
                              <div>
                                <div className="font-medium text-gray-900 text-lg">{pair.subject}</div>
                                <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                                  {pair.teacher && (
                                    <span className="flex items-center gap-1">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                      </svg>
                                      {pair.teacher}
                                    </span>
                                  )}
                                  {pair.room && (
                                    <span className="flex items-center gap-1">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                      </svg>
                                      ауд. {pair.room}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {getStatusBadge(pair.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {timetableData.pairs?.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>Расписание не найдено</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
