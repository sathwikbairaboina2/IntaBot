"use client";

import { ConfigProvider, theme as antdTheme } from "antd";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { mono, sans } from "@/lib/fonts";
import { IG, THEME_COOKIE, type ThemeName } from "@/lib/theme";
import { modeFromMessage, modeFromSearch, panelOrigins } from "@/lib/theme-sync";

interface ThemeContext {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const Context = createContext<ThemeContext>({ theme: "light", setTheme: () => {} });

export const useTheme = () => useContext(Context);

export function ThemeProvider({ initialTheme, children }: { initialTheme: ThemeName; children: ReactNode }) {
  const [theme, setThemeState] = useState(initialTheme);

  // The cookie lets the server render the chosen theme on the next request, so there is no flash.
  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // A ?theme= in the url (the control-room panel adds it) wins over the cookie and is stored by setTheme.
  useEffect(() => {
    const fromUrl = modeFromSearch(window.location.search);
    if (fromUrl) setTheme(fromUrl);
  }, [setTheme]);

  // The panel posts the new mode when its toggle changes.
  useEffect(() => {
    const allowed = panelOrigins(process.env.NEXT_PUBLIC_PANEL_ORIGINS);
    const onMessage = (event: MessageEvent) => {
      const next = modeFromMessage(event, allowed);
      if (next) setTheme(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setTheme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  const tokens = IG[theme];

  return (
    <Context.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: theme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: tokens.action,
            colorInfo: tokens.action,
            colorError: tokens.destructive,
            colorTextLightSolid: "#ffffff",
            colorBgBase: tokens.ground,
            colorBorder: tokens.hairline,
            colorTextBase: tokens.text,
            colorTextSecondary: tokens.textSecondary,
            borderRadius: 8,
            fontFamily: sans.style.fontFamily,
            fontFamilyCode: mono.style.fontFamily,
            fontSize: 14,
            controlHeight: 34,
            wireframe: false,
          },
          components: {
            Button: { borderRadius: 8, fontWeight: 600 },
            Input: { borderRadius: 8 },
            Tag: { borderRadiusSM: 6 },
            Layout: {
              bodyBg: tokens.ground,
              siderBg: tokens.ground,
              lightSiderBg: tokens.ground,
              headerBg: tokens.surface,
              headerHeight: 52,
              headerPadding: "0 20px",
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </Context.Provider>
  );
}
