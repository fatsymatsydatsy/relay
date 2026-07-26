import type { Metadata } from "next";
import { Spectral, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import PostHogProvider from "@/components/PostHogProvider";

const display = Spectral({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600"],
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Relay · We call pharmacies so you don't have to",
  description:
    "Enter your medication and area. Relay's AI calls nearby UK pharmacies, finds who has stock, and tells you exactly what to do next. Free.",
  openGraph: {
    title: "Relay · We call pharmacies so you don't have to",
    description:
      "Stop calling 30 pharmacies. Relay's AI finds your medication and tells you what to do next.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className={`${display.variable} ${sans.variable} ${mono.variable}`}>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
