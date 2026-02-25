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
  metadataBase: new URL("https://www.prismo.us"),
  title: "Prismo - Análisis de Acciones con IA Multimodelo",
  description: "El primer multimodelo de valuación fully customizable. 20+ modelos de valuación, Monte Carlo, análisis neural y más. Inputs totalmente personalizables.",
  keywords: "stock analysis, valuation models, DCF, DDM, Graham, Monte Carlo, stock valuation, investment analysis, Prismo",
  alternates: {
    canonical: "https://www.prismo.us",
  },
  openGraph: {
    title: "Prismo",
    description: "El primer multimodelo de valuación fully customizable",
    url: "https://www.prismo.us",
    siteName: "Prismo",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prismo - Análisis de Acciones con IA",
    description: "El primer multimodelo de valuación fully customizable",
    site: "@prismo_us",
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
