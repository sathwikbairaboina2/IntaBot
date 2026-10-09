import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { sans } from "@/lib/fonts";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = { title: { default: "instabot", template: "%s · instabot" } };

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
