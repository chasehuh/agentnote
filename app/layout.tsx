import type { Metadata, Viewport } from "next";
import { ThemeBoot } from "@/components/theme-boot";
import { faviconBootScript } from "@/lib/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "memo",
  description: "Minimal synced notes",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  appleWebApp: {
    capable: true,
    title: "memo",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
    { media: "(prefers-color-scheme: light)", color: "#f3f3f3" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" data-theme="cursor" data-appearance="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: faviconBootScript() }} />
      </head>
      <body className="h-full">
        <ThemeBoot />
        {children}
      </body>
    </html>
  );
}
