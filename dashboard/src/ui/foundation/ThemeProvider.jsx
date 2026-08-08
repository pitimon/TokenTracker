import React, { createContext, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

const THEME_STORAGE_KEY = "tokentracker-theme";

/**
 * @typedef {"light" | "dark" | "system"} Theme
 * @typedef {{ theme: Theme, setTheme: (theme: Theme) => void, toggleTheme: () => void, resolvedTheme: "light" | "dark" }} ThemeContextValue
 */

/** @type {React.Context<ThemeContextValue | null>} */
export const ThemeContext = createContext(null);

/** @returns {Theme} */
function getInitialTheme() {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Ignore unavailable localStorage.
  }
  return "system";
}

/** @returns {"light" | "dark"} */
function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** @param {"light" | "dark"} resolvedTheme */
function applyThemeToDOM(resolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
}

/** @param {{ children: React.ReactNode }} props */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() => (theme === "system" ? getSystemTheme() : theme));

  useEffect(() => {
    applyThemeToDOM(resolvedTheme);
  }, [resolvedTheme]);

  useLayoutEffect(() => {
    setResolvedTheme(theme === "system" ? getSystemTheme() : theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined" || theme !== "system") return undefined;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event) => setResolvedTheme(event.matches ? "dark" : "light");
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // Ignore unavailable localStorage.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((previous) => {
      const next = previous === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Ignore unavailable localStorage.
        }
      }
      return next;
    });
  }, []);

  const contextValue = useMemo(
    () => ({ theme, setTheme, toggleTheme, resolvedTheme }),
    [theme, setTheme, toggleTheme, resolvedTheme],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}
