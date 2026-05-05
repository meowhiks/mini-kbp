# Руководство по уведомлениям и фоновой синхронизации

## Обзор

Реализована полноценная фоновая синхронизация с уведомлениями для всех версий Android (API 21+).

## Компоненты

### Java-классы

| Файл | Описание |
|------|----------|
| `BackgroundSyncWorker.java` | Фоновая работа: парсинг журнала и расписания каждые 30 минут |
| `NotificationWorker.java` | Показ уведомлений с поддержкой каналов (Android 8+) |
| `NotificationScheduler.java` | Планировщик уведомлений и периодической синхронизации |
| `NotificationPlugin.java` | Capacitor-плагин для JS-интеграции |
| `PermissionHelper.java` | Управление разрешениями (Android 13+ POST_NOTIFICATIONS) |
| `BootReceiver.java` | Автозапуск синхронизации после перезагрузки устройства |
| `MainActivity.java` | Инициализация при запуске приложения |

### TypeScript-файлы

| Файл | Описание |
|------|----------|
| `kbp-app/mobile/plugins/NotificationPlugin.ts` | TypeScript-обёртка для Capacitor-плагина |
| `kbp-app/mobile/hooks/useBackgroundSync.ts` | React-хук для управления синхронизацией |
| `kbp-app/mobile/components/NotificationSettings.tsx` | Готовый UI компонент настроек |

## Каналы уведомлений

Для Android 8.0+ (API 26) созданы 3 канала:

1. **journal_updates** - Обновления журнала (высокий приоритет)
2. **timetable_updates** - Обновления расписания (высокий приоритет)
3. **general_notifications** - Общие уведомления (средний приоритет)

## Совместимость по версиям Android

| Android | API | Особенности |
|---------|-----|-------------|
| 5.0-5.1 | 21-22 | Базовая поддержка |
| 6.0 | 23 | Runtime permissions (INTERNET) |
| 7.0-7.1 | 24-25 | Multi-window (не влияет) |
| 8.0-8.1 | 26-27 | **Notification channels обязательны** |
| 9.0 | 28 | Ограничения фоновой активности |
| 10 | 29 | Scoped Storage |
| 11 | 30 | Однозапросный permission |
| 12 | 31 | **FLAG_IMMUTABLE для PendingIntent** |
| 12L | 32 | --- |
| 13 | 33 | **POST_NOTIFICATIONS permission** |
| 14 | 34 | Усиленные ограничения фоновых сервисов |
| 15 | 35 | --- |

## API для интеграции

### Из JavaScript/TypeScript

```typescript
import { NotificationPlugin } from './mobile/plugins/NotificationPlugin';

// Проверка разрешения
const { granted, required } = await NotificationPlugin.checkPermission();

// Запрос разрешения (Android 13+)
await NotificationPlugin.requestPermission();

// Запуск фоновой синхронизации
await NotificationPlugin.startPeriodicSync();

// Остановка синхронизации
await NotificationPlugin.stopPeriodicSync();

// Проверка статуса
const { running } = await NotificationPlugin.isSyncRunning();

// Тестовое уведомление
await NotificationPlugin.syncNow();

// Отправка уведомления
await NotificationPlugin.scheduleBackgroundNotification({
  title: 'Заголовок',
  body: 'Текст уведомления',
  channel: 'journal', // или 'timetable', 'general'
  delaySeconds: 0,
});

// Открытие настроек
await NotificationPlugin.openSettings({ type: 'notification' });
```

### Использование React-хука

```typescript
import { useBackgroundSync } from './mobile/hooks/useBackgroundSync';

function SettingsScreen() {
  const {
    isRunning,
    permissionGranted,
    isLoading,
    startSync,
    stopSync,
    requestPermission,
  } = useBackgroundSync();

  return (
    <View>
      <Text>
        Статус: {isRunning ? 'Активна' : 'Не активна'}
      </Text>
      <Button
        title={isRunning ? 'Остановить' : 'Запустить'}
        onPress={isRunning ? stopSync : startSync}
      />
    </View>
  );
}
```

## Настройка API endpoints

В `BackgroundSyncWorker.java` замените URL на ваши реальные:

```java
private static final String API_BASE_URL = "https://your-api.com";
private static final String API_JOURNAL_ENDPOINT = "/api/journal";
private static final String API_TIMETABLE_ENDPOINT = "/api/timetable";
```

## Формат данных API

### Журнал оценок

Ожидаемый JSON ответ:

```json
{
  "marks": [
    {"id": "123", "subject": "Математика", "value": "5", "date": "2026-04-30"},
    {"id": "124", "subject": "Русский язык", "value": "4", "date": "2026-04-30"}
  ]
}
```

### Расписание

```json
{
  "lessons": [
    {
      "date": "2026-05-01",
      "startTime": "08:30",
      "subject": "Математика",
      "room": "101"
    }
  ]
}
```

## Разрешения

В `AndroidManifest.xml` добавлены:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

## Тестирование

1. Установите приложение
2. При первом запуске будет запрошено разрешение на уведомления (Android 13+)
3. Включите уведомления в настройках приложения
4. Через 30 минут проверьте получение уведомлений

Для немедленного теста:
```typescript
await NotificationPlugin.syncNow();
```

## Отладка

Логи выводятся в Logcat с тегами:
- `BackgroundSyncWorker`
- `NotificationWorker`
- `NotificationScheduler`
- `PermissionHelper`

Фильтр для Logcat:
```
adb logcat -s BackgroundSyncWorker NotificationWorker NotificationScheduler
```

## Известные ограничения

1. **Минимальный интервал WorkManager**: 15 минут (установлено 30 мин)
2. **Doze mode**: На некоторых устройствах синхронизация может задерживаться
3. **Кастомные ROM**: Xiaomi/Huawei могут требовать дополнительных настроек батареи
