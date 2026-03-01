import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/i18n/LanguageContext";
import { ClerkProvider } from "@clerk/nextjs";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#10b981",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.prismo.us"),
  title: "Prismo - Analisis de Acciones con IA Multimodelo",
  description: "El primer multimodelo de valuacion fully customizable. 20+ modelos de valuacion, Monte Carlo, analisis neural y mas. Inputs totalmente personalizables.",
  keywords: "stock analysis, valuation models, DCF, DDM, Graham, Monte Carlo, stock valuation, investment analysis, Prismo",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Prismo",
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  alternates: {
    canonical: "https://www.prismo.us",
  },
  openGraph: {
    title: "Prismo - Analisis de Acciones con IA Multimodelo",
    description: "El primer multimodelo de valuacion fully customizable. 20+ modelos, Monte Carlo, analisis neural, clasificador hibrido y mas.",
    url: "https://www.prismo.us",
    siteName: "Prismo",
    type: "website",
    locale: "es_AR",
    images: [
      {
        url: "/cover-prismo.jpg",
        width: 1200,
        height: 630,
        alt: "Prismo - Analisis de Acciones con IA Multimodelo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Prismo - Analisis de Acciones con IA Multimodelo",
    description: "20+ modelos de valuacion, Monte Carlo, analisis neural y clasificador hibrido. Todo personalizable.",
    site: "@prismo_us",
    images: ["/cover-prismo.jpg"],
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
          <ServiceWorkerRegistrar />
          {/* Vercel Analytics */}
          <Analytics />
          {/* Google Analytics 4 */}
          {process.env.NEXT_PUBLIC_GA_ID && (
            <>
              <Script
                src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
                strategy="afterInteractive"
              />
              <Script id="ga4-init" strategy="afterInteractive">
                {`
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}', { page_path: window.location.pathname });
                `}
              </Script>
            </>
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}
