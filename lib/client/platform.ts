import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  try {
    const isNative = Capacitor.isNativePlatform();
    console.log("[Platform] isNativePlatform:", isNative);
    return isNative;
  } catch (err) {
    console.error("[Platform] Error checking isNativePlatform:", err);
    return false;
  }
}

