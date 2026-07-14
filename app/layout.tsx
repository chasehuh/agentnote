import type { Metadata } from "next";
import { ThemeBoot } from "@/components/theme-boot";
import { faviconBootScript } from "@/lib/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "memo",
  description: "Minimal synced notes",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
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
