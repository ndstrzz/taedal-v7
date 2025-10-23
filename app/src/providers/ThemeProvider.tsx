import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark" | "system";

type ThemeCtx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyThemeClass(theme: Theme) {
  const effective = theme === "system" ? resolveSystemTheme() : theme;
  const root = document.documentElement;
  if (effective === "dark") {
    root.classList.add("dark");
    root.setAttribute("data-theme", "dark");
  } else {
    root.classList.remove("dark");
    root.setAttribute("data-theme", "light");
  }
}

const STORAGE_KEY = "taedal:theme";

const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, _setTheme] = useState<Theme>(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null) || null;
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    // default: dark (your UI is dark-first)
    return "dark";
  });

  // Apply on mount & when theme changes
  useEffect(() => {
    applyThemeClass(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  // React to OS scheme only when in system mode
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyThemeClass("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => _setTheme(t), []);
  const toggleTheme = useCallback(() => {
    _setTheme((cur) => (cur === "dark" ? "light" : "dark"));
  }, []);

  // Assistant hooks
  useEffect(() => {
    const onToggle = () => toggleTheme();
    const onSet = (e: Event) => {
      const ce = e as CustomEvent<Theme>;
      const next = ce.detail;
      if (next === "light" || next === "dark" || next === "system") {
        _setTheme(next);
      }
    };
    window.addEventListener("assistant:toggleTheme", onToggle as EventListener);
    window.addEventListener("assistant:setTheme", onSet as EventListener);
    return () => {
      window.removeEventListener("assistant:toggleTheme", onToggle as EventListener);
      window.removeEventListener("assistant:setTheme", onSet as EventListener);
    };
  }, [toggleTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export default ThemeProvider;

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
