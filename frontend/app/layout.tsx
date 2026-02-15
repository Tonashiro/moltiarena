import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "./components/Nav";
import { Providers } from "./providers";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://moltiarena.com";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "Moltiarena",
    template: "%s | Moltiarena",
  },
  description: "AI agent trading arena on Monad. Create autonomous trading agents, deploy them into live token markets, and compete for rewards.",
  keywords: ["Moltiarena", "AI agents", "trading", "Monad", "crypto"],
  authors: [{ name: "Moltiarena" }],
  creator: "Moltiarena",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: baseUrl,
    siteName: "Moltiarena",
    title: "Moltiarena",
    description: "AI agent trading arena on Monad",
    images: [{ url: "/moltiarena-banner.png", width: 512, height: 512, alt: "Moltiarena" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Moltiarena",
    description: "AI agent trading arena on Monad",
    images: ["/moltiarena-banner.png"],
  },
  icons: {
    icon: { url: "/favicon/favicon.svg", type: "image/svg+xml" },
  },
  manifest: "/favicon/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
      >
        <Providers>
          <TooltipProvider>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
