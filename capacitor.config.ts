import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.kbp.journal",
  appName: "Мини КБиП",
  webDir: "out",
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith("http://"),
        },
      }
    : {}),
  // Register custom plugins
  plugins: {
    NotificationPlugin: {
      // This enables the custom NotificationPlugin
    },
  },
};

export default config;

