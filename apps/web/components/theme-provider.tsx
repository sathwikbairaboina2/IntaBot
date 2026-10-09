"use client";

import { ConfigProvider, theme as antdTheme } from "antd";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { mono, sans } from "@/lib/fonts";
import { IG, THEME_COOKIE, type ThemeName } from "@/lib/theme";

interface ThemeContext {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const Context = createContext<ThemeContext>({ theme: "dark", setTheme: () => {} });

export const useTheme = () => useContext(Context);

export function ThemeProvider({ initialTheme, children }: { initialTheme: ThemeName; children: ReactNode }) {
  const [theme, setThemeState] = useState(initialTheme);

  // The cookie lets the server render the chosen theme on the next request, so there is no flash.
  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

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
