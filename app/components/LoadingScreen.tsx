"use client";

interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-zinc-950 px-6">
      <div className="opacity-0 animate-[fadeIn_220ms_ease-out_forwards]">
        <div className="text-2xl font-bold text-gray-900 dark:text-zinc-100">Мини КБиП</div>
      </div>

      {message && <div className="mt-6 text-sm text-gray-500 dark:text-zinc-400">{message}</div>}

      <div className="fixed bottom-8 left-6 right-6">
        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800">
          <div className="h-full w-1/3 rounded-full bg-blue-500 animate-[loaderBar_1.1s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}
