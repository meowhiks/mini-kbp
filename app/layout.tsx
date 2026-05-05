import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Мини КБиП",
  description: "Электронный журнал и расписание для студентов КБиП",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/minikbp.svg", type: "image/svg+xml" },
    ],
    shortcut: "/minikbp.svg",
    apple: "/minikbp.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Мини КБиП",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
      >
        <div className="flex-1">
        {children}
        </div>
      </body>
    </html>
  );
}
