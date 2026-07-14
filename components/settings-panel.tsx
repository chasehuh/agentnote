"use client";

import { useEffect } from "react";
import {
  THEMES,
  type Appearance,
  type ThemeId,
  type ThemeDefinition,
} from "@/lib/themes";

function ThemeSwatch({
  theme,
  appearance,
}: {
  theme: ThemeDefinition;
  appearance: Appearance;
}) {
  const tokens = appearance === "light" ? theme.light : theme.dark;
  return (
    <span className="memo-settings__swatch" aria-hidden>
      <i style={{ background: tokens.editor }} />
      <i style={{ background: tokens.surface }} />
      <i style={{ background: tokens.textAccent }} />
      <i style={{ background: tokens.editorFg }} />
    </span>
  );
}

export function SettingsPanel({
  open,
  themeId,
  appearance,
  onClose,
  onThemeChange,
  onAppearanceChange,
  onLock,
}: {
  open: boolean;
  themeId: ThemeId;
  appearance: Appearance;
  onClose: () => void;
  onThemeChange: (id: ThemeId) => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onLock: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="memo-settings-root" onClick={onClose} role="presentation">
      <div
        className="memo-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="memo-settings__header">
          <h2 id="memo-settings-title">Settings</h2>
          <button
            type="button"
            className="memo-settings__ghost"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="memo-settings__body">
          <section className="memo-settings__section">
            <h3 className="memo-settings__label">Appearance</h3>
            <div className="memo-settings__segment" role="group">
              <button
                type="button"
                className="memo-settings__segment-btn"
                data-active={appearance === "light" ? "true" : "false"}
                onClick={() => onAppearanceChange("light")}
              >
                Light
              </button>
              <button
                type="button"
                className="memo-settings__segment-btn"
                data-active={appearance === "dark" ? "true" : "false"}
                onClick={() => onAppearanceChange("dark")}
              >
                Dark
              </button>
            </div>
          </section>

          <section className="memo-settings__section">
            <h3 className="memo-settings__label">Color system</h3>
            <div className="memo-settings__themes">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="memo-settings__theme"
                  data-active={theme.id === themeId ? "true" : "false"}
                  onClick={() => onThemeChange(theme.id)}
                >
                  <ThemeSwatch theme={theme} appearance={appearance} />
                  <span className="memo-settings__theme-copy">
                    <span className="memo-settings__theme-name">
                      {theme.name}
                    </span>
                    <span className="memo-settings__theme-sub">
                      {theme.editor}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="memo-settings__section">
            <h3 className="memo-settings__label">Session</h3>
            <button
              type="button"
              className="memo-settings__theme"
              onClick={onLock}
            >
              <span className="memo-settings__theme-copy">
                <span className="memo-settings__theme-name">Lock memo</span>
                <span className="memo-settings__theme-sub">
                  Require password again
                </span>
              </span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
