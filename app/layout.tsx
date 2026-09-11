import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GURMİNİK",
  description: "Bulut tabanlı meyve alış, satış ve işletme takip sistemi.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GURMİNİK", statusBarStyle: "black-translucent" },
  icons: { icon: "/favicon.svg", apple: "/icon-192.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <head><meta name="theme-color" content="#111213"/></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
