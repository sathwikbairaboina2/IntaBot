export type ThemeName = "dark" | "light";

export const THEME_COOKIE = "intabot-theme";

export interface Tokens {
  ground: string;
  surface: string;
  hairline: string;
  text: string;
  textSecondary: string;
  action: string;
  destructive: string;
}

/** Instagram's palette, copied from instascraper (web/lib/themes.ts) so the three tools match. */
export const IG: Record<ThemeName, Tokens> = {
  dark: {
    ground: "#000000",
    surface: "#121212",
    hairline: "#262626",
    text: "#f5f5f5",
    textSecondary: "#a8a8a8",
    action: "#e1306c",
    destructive: "#ed4956",
  },
  light: {
    ground: "#ffffff",
    surface: "#fafafa",
    hairline: "#dbdbdb",
    text: "#000000",
    textSecondary: "#5e5e5e",
    action: "#e1306c",
    destructive: "#c9303e",
  },
};

export function parseTheme(value: string | null | undefined): ThemeName {
  return value === "dark" ? "dark" : "light";
}
