"use client";

import { useEffect } from "react";
import {
  THEMES,
  type Appearance,
  type ThemeId,
  type ThemeDefinition,
} from "@/lib/themes";
import { PoweredBySume } from "./powered-by-sume";

function ThemeSwatch({
  theme,
  appearance,
}: {
  theme: ThemeDefinition;
  appearance: Appearance;
}) {
  const tokens = appearance === "light" ? theme.light : theme.dark;
  return (
    <span className="agentnote-settings__swatch" aria-hidden>
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
  wrap,
  digitShortcuts,
  onClose,
  onThemeChange,
  onAppearanceChange,
  onWrapChange,
  onDigitShortcutsChange,
}: {
  open: boolean;
  themeId: ThemeId;
  appearance: Appearance;
  wrap: boolean;
  digitShortcuts: boolean;
  onClose: () => void;
  onThemeChange: (id: ThemeId) => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onWrapChange: (wrap: boolean) => void;
  onDigitShortcutsChange: (enabled: boolean) => void;
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
    <div className="agentnote-settings-root" onClick={onClose} role="presentation">
      <div
        className="agentnote-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agentnote-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="agentnote-settings__header">
          <h2 id="agentnote-settings-title">Settings</h2>
          <button
            type="button"
            className="agentnote-settings__ghost"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="agentnote-settings__body">
          <section className="agentnote-settings__section">
            <h3 className="agentnote-settings__label">Appearance</h3>
            <div className="agentnote-settings__segment" role="group">
              <button
                type="button"
                className="agentnote-settings__segment-btn"
                data-active={appearance === "light" ? "true" : "false"}
                onClick={() => onAppearanceChange("light")}
              >
                Light
              </button>
              <button
                type="button"
                className="agentnote-settings__segment-btn"
                data-active={appearance === "dark" ? "true" : "false"}
                onClick={() => onAppearanceChange("dark")}
              >
                Dark
              </button>
            </div>
          </section>

          <section className="agentnote-settings__section">
            <h3 className="agentnote-settings__label">Editor</h3>
            <div className="agentnote-settings__segment" role="group">
              <button
                type="button"
                className="agentnote-settings__segment-btn"
                data-active={wrap ? "true" : "false"}
                onClick={() => onWrapChange(true)}
              >
                Wrap
              </button>
              <button
                type="button"
                className="agentnote-settings__segment-btn"
                data-active={!wrap ? "true" : "false"}
                onClick={() => onWrapChange(false)}
              >
                No wrap
              </button>
            </div>
          </section>

          <section className="agentnote-settings__section">
            <h3 className="agentnote-settings__label">
              ⌘1–9 note jump
              <span className="agentnote-settings__sub">
                Select the Nth note in the sidebar list. Off by default — most
                browsers use these for tab switching.
              </span>
            </h3>
            <div className="agentnote-settings__segment" role="group">
              <button
                type="button"
                className="agentnote-settings__segment-btn"
                data-active={digitShortcuts ? "true" : "false"}
                onClick={() => onDigitShortcutsChange(true)}
              >
                On
              </button>
              <button
                type="button"
                className="agentnote-settings__segment-btn"
                data-active={!digitShortcuts ? "true" : "false"}
                onClick={() => onDigitShortcutsChange(false)}
              >
                Off
              </button>
            </div>
          </section>

          <section className="agentnote-settings__section">
            <h3 className="agentnote-settings__label">Color system</h3>
            <div className="agentnote-settings__themes">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="agentnote-settings__theme"
                  data-active={theme.id === themeId ? "true" : "false"}
                  onClick={() => onThemeChange(theme.id)}
                >
                  <ThemeSwatch theme={theme} appearance={appearance} />
                  <span className="agentnote-settings__theme-copy">
                    <span className="agentnote-settings__theme-name">
                      {theme.name}
                    </span>
                    <span className="agentnote-settings__theme-sub">
                      {theme.editor}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="agentnote-settings__footer">
          <PoweredBySume />
        </footer>
      </div>
    </div>
  );
}
