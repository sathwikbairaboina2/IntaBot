import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { sans } from "@/lib/fonts";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = { title: { default: "instabot", template: "%s · instabot" } };

// viewport-fit=cover lets the bars sit under the notch; the CSS pads them with the safe-area insets.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme}>
      <body className={sans.className}>
        <AntdRegistry>
          <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
