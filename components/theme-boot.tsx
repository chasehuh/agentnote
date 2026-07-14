"use client";

import { useEffect } from "react";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  applyTheme,
  isAppearance,
  isThemeId,
} from "@/lib/themes";

export function ThemeBoot() {
  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const savedAppearance = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    applyTheme(
      savedTheme && isThemeId(savedTheme) ? savedTheme : DEFAULT_THEME_ID,
      savedAppearance && isAppearance(savedAppearance)
        ? savedAppearance
        : DEFAULT_APPEARANCE,
    );
  }, []);

  return null;
}
