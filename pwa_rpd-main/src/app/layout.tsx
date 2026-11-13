import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import ListenNowPlayer from "@/components/ListenNowPlayer";
import { AudioProvider } from "@/components/AudioProvider";
import PwaUpdates from "@/components/PwaUpdates";
import GlobalChatBox from "@/components/GlobalChatBox";

export const metadata: Metadata = {
  title: "Radio PPI Dunia",
  description: "Radio PPI Dunia - Suara Anak Bangsa, Satu Cinta, Satu Indonesia",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Radio PPI Dunia",
  },
  icons: {
    icon: "/rpd-icon-192.png",
    apple: "/rpd-icon-192.png"
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#000000" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="RPD Mobile" />
      </head>
      <body className="antialiased">
        <AudioProvider>
          <Navbar />
          <ListenNowPlayer />
          <GlobalChatBox />
          {children}
          <PwaUpdates />
        </AudioProvider>

      </body>
    </html>
  );
}

