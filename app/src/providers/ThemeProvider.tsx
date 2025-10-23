import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

type ThemeCtx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
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
    if (saved === "light" || saved === "dark") return saved;
    // default: dark (your UI is dark-first)
    return "dark";
  });

  useEffect(() => {
    applyThemeClass(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => _setTheme(t), []);
  const toggleTheme = useCallback(() => {
    _setTheme((cur) => (cur === "dark" ? "light" : "dark"));
  }, []);

  // Allow the assistant to toggle theme via a DOM CustomEvent
  useEffect(() => {
    const onToggle = () => toggleTheme();
    window.addEventListener("assistant:toggleTheme", onToggle as EventListener);
    return () => window.removeEventListener("assistant:toggleTheme", onToggle as EventListener);
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
