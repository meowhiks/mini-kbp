"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface SwipeLayoutProps {
  children: React.ReactNode[];
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
}

export default function SwipeLayout({ children, initialIndex = 1, onIndexChange }: SwipeLayoutProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [translateX, setTranslateX] = useState(-initialIndex * 100);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const velocityRef = useRef(0);
  const lastTimeRef = useRef(Date.now());
  const lastXRef = useRef(0);

  // Swipe sensitivity settings
  const SWIPE_THRESHOLD = 50; // Порог активации: 50px (вместо 40px)
  const VERTICAL_LOCK_RATIO = 1.3; // Блокировка вертикали: 1.3× (вместо 2×)
  const SWITCH_THRESHOLD = 0.28; // Порог переключения: 28% ширины экрана (вместо 25%)
  const VELOCITY_THRESHOLD = 0.9; // Порог скорости: 0.9 (вместо 0.8)
  const EDGE_RESISTANCE = 0.25; // Сопротивление краёв: 0.25 (вместо 0.3)

  useEffect(() => {
    setTranslateX(-currentIndex * 100);
    onIndexChange?.(currentIndex);
  }, [currentIndex]);

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    setStartX(clientX);
    setStartY(clientY);
    setIsDragging(true);
    velocityRef.current = 0;
    lastTimeRef.current = Date.now();
    lastXRef.current = clientX;
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const diffX = clientX - startX;
    const diffY = clientY - startY;

    // Блокировка вертикали: если вертикальное движение больше горизонтального, игнорируем
    if (Math.abs(diffY) > Math.abs(diffX) * VERTICAL_LOCK_RATIO) {
      return;
    }

    // Расчёт скорости
    const currentTime = Date.now();
    const timeDiff = currentTime - lastTimeRef.current;
    if (timeDiff > 0) {
      velocityRef.current = Math.abs(clientX - lastXRef.current) / timeDiff;
    }
    lastTimeRef.current = currentTime;
    lastXRef.current = clientX;

    let percent = (diffX / window.innerWidth) * 100;

    // Сопротивление краёв: уменьшаем движение у краёв
    if (currentIndex === 0 && diffX > 0) {
      percent *= EDGE_RESISTANCE;
    } else if (currentIndex === children.length - 1 && diffX < 0) {
      percent *= EDGE_RESISTANCE;
    }

    const baseTranslate = -currentIndex * 100;
    setTranslateX(baseTranslate + percent);
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;

    const clientX = "changedTouches" in e ? e.changedTouches[0].clientX : e.clientX;
    const diff = clientX - startX;
    const absDiff = Math.abs(diff);

    // Проверяем пороги: расстояние или скорость
    const shouldSwitch = absDiff > SWIPE_THRESHOLD || velocityRef.current > VELOCITY_THRESHOLD;

    if (shouldSwitch && absDiff > window.innerWidth * SWITCH_THRESHOLD) {
      if (diff > 0 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      } else if (diff < 0 && currentIndex < children.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        setTranslateX(-currentIndex * 100);
      }
    } else {
      setTranslateX(-currentIndex * 100);
    }

    setIsDragging(false);
  };

  const goToPage = (index: number) => {
    setCurrentIndex(index);
  };

  const pages = ["Расписание", "Главная", "Журнал"];

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-100 flex flex-col">
      {/* Top Navigation Indicator - NO BACKGROUND */}
      <div className="z-50 py-3">
        <div className="flex justify-center items-center gap-8">
          {pages.map((page, index) => (
            <button
              key={page}
              onClick={() => goToPage(index)}
              className={`text-sm font-medium transition-colors relative pb-1 ${
                currentIndex === index ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {page}
              {currentIndex === index && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Swipeable Content */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleTouchStart}
        onMouseMove={handleTouchMove}
        onMouseUp={handleTouchEnd}
        onMouseLeave={handleTouchEnd}
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(${translateX}%)`,
            transition: isDragging ? "none" : "transform 0.35s cubic-bezier(0.22, 0.9, 0.2, 1)",
          }}
        >
          {children.map((child, index) => (
            <div
              key={index}
              className="w-full h-full flex-shrink-0 overflow-y-auto"
              style={{ width: "100vw" }}
            >
              {child}
            </div>
          ))}
        </div>
      </div>

      <div className="py-2" />
    </div>
  );
}
