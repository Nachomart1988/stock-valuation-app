import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/i18n/LanguageContext";
import { ClerkProvider } from "@clerk/nextjs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StockAnalyzer Pro - Valuación de Acciones con IA",
  description: "Plataforma profesional de análisis de acciones con 20+ modelos de valuación, Monte Carlo, análisis neural y más. Inputs totalmente personalizables.",
  keywords: "stock analysis, valuation models, DCF, DDM, Graham, Monte Carlo, stock valuation, investment analysis",
  openGraph: {
    title: "StockAnalyzer Pro",
    description: "20+ modelos de valuación profesional con inputs personalizables",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="es" suppressHydrationWarning>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <LanguageProvider>
            {children}
          </LanguageProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
