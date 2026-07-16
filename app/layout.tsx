import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeBoot } from "@/components/theme-boot";
import { faviconBootScript } from "@/lib/themes";
import "./globals.css";

export const metadata: Metadata = {
  // Plain default (no title template) so client document.title updates are not overridden.
  title: "agentnote",
  description: "Minimal notepad built to sit next to the agent tab",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  appleWebApp: {
    capable: true,
    title: "agentnote",
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
        <ClerkProvider
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          afterSignOutUrl="/login"
        >
          <ThemeBoot />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
