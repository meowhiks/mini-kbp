"use client";

import { useState, useEffect } from "react";

export default function DebugConsole() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const addLog = (type: string, args: any[]) => {
      const msg = `[${type}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0, 200) : String(a).slice(0, 200)).join(' ')}`;
      setLogs(prev => {
        const newLogs = [...prev, msg].slice(-20);
        return newLogs;
      });
    };

    console.log = (...args: any[]) => {
      originalLog.apply(console, args);
      addLog('LOG', args);
    };
    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      addLog('ERR', args);
    };
    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      addLog('WRN', args);
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-2 right-2 z-50 font-mono text-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gray-900 text-white px-2 py-1 rounded shadow-lg mb-1"
      >
        {isOpen ? 'Скрыть лог' : 'Показать лог'}
      </button>
      {isOpen && (
        <div className="bg-gray-900 text-green-400 p-2 rounded shadow-lg max-w-xs max-h-60 overflow-auto">
          <div className="flex justify-between mb-2">
            <span className="text-gray-400">Debug Console</span>
            <button onClick={() => { setLogs([]); setIsVisible(false); }} className="text-red-400">
              Закрыть
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="text-gray-500">Нет логов...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="mb-1 border-b border-gray-700 pb-1">
                {log}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
