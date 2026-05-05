import { Preferences } from "@capacitor/preferences";
import { isNativeApp } from "./platform";

// Try to use Preferences, fallback to localStorage if fails
async function safePreferencesGet(key: string): Promise<string | null> {
  try {
    const result = await Preferences.get({ key });
    return result.value;
  } catch (err) {
    console.warn(`[Storage] Preferences.get failed for ${key}, falling back to localStorage:`, err);
    return localStorage.getItem(key);
  }
}

async function safePreferencesSet(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
  } catch (err) {
    console.warn(`[Storage] Preferences.set failed for ${key}, falling back to localStorage:`, err);
    localStorage.setItem(key, value);
  }
}

export async function storageGet(key: string): Promise<string | null> {
  const native = isNativeApp();
  console.log(`[Storage] GET ${key}, native=${native}`);

  if (native) {
    const result = await safePreferencesGet(key);
    console.log(`[Storage] GET ${key} result=`, result ? "exists" : "null");
    return result;
  }

  const value = localStorage.getItem(key);
  console.log(`[Storage] GET ${key} from localStorage=`, value ? "exists" : "null");
  return value;
}

export async function storageSet(key: string, value: string): Promise<void> {
  const native = isNativeApp();
  console.log(`[Storage] SET ${key}, native=${native}, len=${value?.length}`);

  try {
    if (native) {
      await safePreferencesSet(key, value);
      console.log(`[Storage] SET ${key} SUCCESS`);
    } else {
      localStorage.setItem(key, value);
      console.log(`[Storage] SET ${key} localStorage SUCCESS`);
    }
  } catch (err) {
    console.error(`[Storage] SET ${key} FAILED:`, err);
  }
}

export async function storageRemove(key: string): Promise<void> {
  if (isNativeApp()) {
    await Preferences.remove({ key });
  } else {
    localStorage.removeItem(key);
  }
}

export async function storageClear(): Promise<void> {
  if (isNativeApp()) {
    await Preferences.clear();
  } else {
    localStorage.clear();
  }
}

// Helper for objects
export async function storageGetObject<T>(key: string): Promise<T | null> {
  const value = await storageGet(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function storageSetObject<T>(key: string, value: T): Promise<void> {
  await storageSet(key, JSON.stringify(value));
}
