import type { Metadata } from "next";
import { Geist, Geist_Mono, Rajdhani } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/navigation";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 計測値表示用のディスプレイ書体（レース計時モニター風）
const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "耐久レース戦略アプリ",
  description: "バイク耐久レースの燃料・ピットイン・ライダー順をリアルタイムに最適化する戦略支援ツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${rajdhani.variable} antialiased min-h-screen bg-background`}
      >
        <div className="flex flex-col md:flex-row min-h-screen">
          <Navigation />
          <main className="flex-1 p-4 md:p-6 max-w-[1600px]">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
