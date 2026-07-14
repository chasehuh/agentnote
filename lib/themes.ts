export type ThemeId =
  | "cursor"
  | "zed"
  | "vscode"
  | "github"
  | "tokyo-night"
  | "catppuccin"
  | "dracula";

export type Appearance = "dark" | "light";

export type ThemeTokens = {
  background: string;
  surface: string;
  elevated: string;
  editor: string;
  element: string;
  elementHover: string;
  elementSelected: string;
  border: string;
  borderVariant: string;
  borderFocused: string;
  text: string;
  textMuted: string;
  textPlaceholder: string;
  textAccent: string;
  editorFg: string;
  editorLineNumber: string;
  editorActiveLineNumber: string;
  success: string;
  warning: string;
  error: string;
  scrollbar: string;
  selection: string;
};

export type ThemeDefinition = {
  id: ThemeId;
  name: string;
  editor: string;
  dark: ThemeTokens;
  light: ThemeTokens;
};

export const THEMES: ThemeDefinition[] = [
  {
    id: "cursor",
    name: "Cursor",
    editor: "Cursor",
    dark: {
      background: "#141414",
      surface: "#181818",
      elevated: "#1c1c1c",
      editor: "#141414",
      element: "#1c1c1c",
      elementHover: "#2a2a2a",
      elementSelected: "#2f2f2f",
      border: "#2b2b2b",
      borderVariant: "#242424",
      borderFocused: "#264f78",
      text: "#e4e4e4",
      textMuted: "#a0a0a0",
      textPlaceholder: "#6e6e6e",
      textAccent: "#81a1c1",
      editorFg: "#d6d6dd",
      editorLineNumber: "#525252",
      editorActiveLineNumber: "#c6c6c6",
      success: "#89d185",
      warning: "#cca700",
      error: "#f14c4c",
      scrollbar: "#5a5a5a66",
      selection: "#264f7880",
    },
    light: {
      background: "#f3f3f3",
      surface: "#f8f8f8",
      elevated: "#ffffff",
      editor: "#ffffff",
      element: "#ffffff",
      elementHover: "#ececec",
      elementSelected: "#e4e4e4",
      border: "#e0e0e0",
      borderVariant: "#ebebeb",
      borderFocused: "#81a1c1",
      text: "#1e1e1e",
      textMuted: "#616161",
      textPlaceholder: "#8b8b8b",
      textAccent: "#3d6d99",
      editorFg: "#1e1e1e",
      editorLineNumber: "#b0b0b0",
      editorActiveLineNumber: "#424242",
      success: "#388a34",
      warning: "#bf8803",
      error: "#e51400",
      scrollbar: "#00000033",
      selection: "#add6ff80",
    },
  },
  {
    id: "zed",
    name: "Zed One",
    editor: "Zed",
    dark: {
      background: "#3b414d",
      surface: "#2f343e",
      elevated: "#2f343e",
      editor: "#282c33",
      element: "#2e343e",
      elementHover: "#363c46",
      elementSelected: "#454a56",
      border: "#464b57",
      borderVariant: "#363c46",
      borderFocused: "#47679e",
      text: "#dce0e5",
      textMuted: "#a9afbc",
      textPlaceholder: "#878a98",
      textAccent: "#74ade8",
      editorFg: "#acb2be",
      editorLineNumber: "#4e5a5f",
      editorActiveLineNumber: "#d0d4da",
      success: "#a1c181",
      warning: "#dec184",
      error: "#d07277",
      scrollbar: "#c8ccd44c",
      selection: "#74ade83d",
    },
    light: {
      background: "#dcdcdd",
      surface: "#ebebec",
      elevated: "#ebebec",
      editor: "#fafafa",
      element: "#ebebec",
      elementHover: "#dfdfe0",
      elementSelected: "#cacaca",
      border: "#c9c9ca",
      borderVariant: "#dfdfe0",
      borderFocused: "#7d82e8",
      text: "#242529",
      textMuted: "#58585a",
      textPlaceholder: "#7e8086",
      textAccent: "#5c78e2",
      editorFg: "#242529",
      editorLineNumber: "#a0a1a7",
      editorActiveLineNumber: "#383a42",
      success: "#50a14f",
      warning: "#c18401",
      error: "#e45649",
      scrollbar: "#383a414c",
      selection: "#5c78e233",
    },
  },
  {
    id: "vscode",
    name: "VS Code",
    editor: "VS Code",
    dark: {
      background: "#181818",
      surface: "#181818",
      elevated: "#1f1f1f",
      editor: "#1f1f1f",
      element: "#1f1f1f",
      elementHover: "#2a2a2a",
      elementSelected: "#37373d",
      border: "#2b2b2b",
      borderVariant: "#2b2b2b",
      borderFocused: "#0078d4",
      text: "#cccccc",
      textMuted: "#9d9d9d",
      textPlaceholder: "#6e7681",
      textAccent: "#0078d4",
      editorFg: "#cccccc",
      editorLineNumber: "#6e7681",
      editorActiveLineNumber: "#cccccc",
      success: "#89d185",
      warning: "#cca700",
      error: "#f14c4c",
      scrollbar: "#5a5a5a66",
      selection: "#264f7880",
    },
    light: {
      background: "#f3f3f3",
      surface: "#f8f8f8",
      elevated: "#ffffff",
      editor: "#ffffff",
      element: "#ffffff",
      elementHover: "#e8e8e8",
      elementSelected: "#e0e0e0",
      border: "#e5e5e5",
      borderVariant: "#ececec",
      borderFocused: "#005fb8",
      text: "#3b3b3b",
      textMuted: "#616161",
      textPlaceholder: "#8b8b8b",
      textAccent: "#005fb8",
      editorFg: "#3b3b3b",
      editorLineNumber: "#6e7681",
      editorActiveLineNumber: "#0e1116",
      success: "#1a7f37",
      warning: "#9a6700",
      error: "#cf222e",
      scrollbar: "#0000002e",
      selection: "#add6ff99",
    },
  },
  {
    id: "github",
    name: "GitHub",
    editor: "GitHub",
    dark: {
      background: "#010409",
      surface: "#0d1117",
      elevated: "#161b22",
      editor: "#0d1117",
      element: "#161b22",
      elementHover: "#21262d",
      elementSelected: "#1f6feb33",
      border: "#30363d",
      borderVariant: "#21262d",
      borderFocused: "#1f6feb",
      text: "#e6edf3",
      textMuted: "#9198a1",
      textPlaceholder: "#656d76",
      textAccent: "#58a6ff",
      editorFg: "#e6edf3",
      editorLineNumber: "#6e7681",
      editorActiveLineNumber: "#e6edf3",
      success: "#3fb950",
      warning: "#d29922",
      error: "#f85149",
      scrollbar: "#484f5866",
      selection: "#1f6feb40",
    },
    light: {
      background: "#f6f8fa",
      surface: "#ffffff",
      elevated: "#ffffff",
      editor: "#ffffff",
      element: "#ffffff",
      elementHover: "#f3f4f6",
      elementSelected: "#ddf4ff",
      border: "#d0d7de",
      borderVariant: "#d8dee4",
      borderFocused: "#0969da",
      text: "#1f2328",
      textMuted: "#656d76",
      textPlaceholder: "#8c959f",
      textAccent: "#0969da",
      editorFg: "#1f2328",
      editorLineNumber: "#8c959f",
      editorActiveLineNumber: "#1f2328",
      success: "#1a7f37",
      warning: "#9a6700",
      error: "#cf222e",
      scrollbar: "#8c959f66",
      selection: "#0969da33",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    editor: "Tokyo Night",
    dark: {
      background: "#16161e",
      surface: "#1a1b26",
      elevated: "#1f2335",
      editor: "#1a1b26",
      element: "#1f2335",
      elementHover: "#292e42",
      elementSelected: "#2f3549",
      border: "#292e42",
      borderVariant: "#24283b",
      borderFocused: "#3d59a1",
      text: "#c0caf5",
      textMuted: "#a9b1d6",
      textPlaceholder: "#565f89",
      textAccent: "#7aa2f7",
      editorFg: "#a9b1d6",
      editorLineNumber: "#3b4261",
      editorActiveLineNumber: "#737aa2",
      success: "#9ece6a",
      warning: "#e0af68",
      error: "#f7768e",
      scrollbar: "#565f8966",
      selection: "#283457",
    },
    light: {
      background: "#d5d6db",
      surface: "#e1e2e7",
      elevated: "#e9e9ed",
      editor: "#e1e2e7",
      element: "#e9e9ed",
      elementHover: "#c4c8da",
      elementSelected: "#b9bed4",
      border: "#c4c8da",
      borderVariant: "#c4c8da",
      borderFocused: "#2e7de9",
      text: "#343b58",
      textMuted: "#565a6e",
      textPlaceholder: "#9699a3",
      textAccent: "#2e7de9",
      editorFg: "#343b58",
      editorLineNumber: "#9699a3",
      editorActiveLineNumber: "#343b58",
      success: "#587539",
      warning: "#8c6c3e",
      error: "#8c4351",
      scrollbar: "#9699a366",
      selection: "#2e7de933",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    editor: "Catppuccin",
    dark: {
      background: "#181825",
      surface: "#1e1e2e",
      elevated: "#313244",
      editor: "#1e1e2e",
      element: "#313244",
      elementHover: "#45475a",
      elementSelected: "#585b70",
      border: "#45475a",
      borderVariant: "#313244",
      borderFocused: "#89b4fa",
      text: "#cdd6f4",
      textMuted: "#a6adc8",
      textPlaceholder: "#6c7086",
      textAccent: "#89b4fa",
      editorFg: "#cdd6f4",
      editorLineNumber: "#6c7086",
      editorActiveLineNumber: "#bac2de",
      success: "#a6e3a1",
      warning: "#f9e2af",
      error: "#f38ba8",
      scrollbar: "#6c708666",
      selection: "#585b7080",
    },
    light: {
      background: "#eff1f5",
      surface: "#e6e9ef",
      elevated: "#ccd0da",
      editor: "#eff1f5",
      element: "#ccd0da",
      elementHover: "#bcc0cc",
      elementSelected: "#acb0be",
      border: "#ccd0da",
      borderVariant: "#dce0e8",
      borderFocused: "#1e66f5",
      text: "#4c4f69",
      textMuted: "#6c6f85",
      textPlaceholder: "#9ca0b0",
      textAccent: "#1e66f5",
      editorFg: "#4c4f69",
      editorLineNumber: "#9ca0b0",
      editorActiveLineNumber: "#4c4f69",
      success: "#40a02b",
      warning: "#df8e1d",
      error: "#d20f39",
      scrollbar: "#9ca0b066",
      selection: "#1e66f533",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    editor: "Dracula",
    dark: {
      background: "#21222c",
      surface: "#282a36",
      elevated: "#343746",
      editor: "#282a36",
      element: "#343746",
      elementHover: "#44475a",
      elementSelected: "#44475a",
      border: "#44475a",
      borderVariant: "#343746",
      borderFocused: "#bd93f9",
      text: "#f8f8f2",
      textMuted: "#bfbfbf",
      textPlaceholder: "#6272a4",
      textAccent: "#bd93f9",
      editorFg: "#f8f8f2",
      editorLineNumber: "#6272a4",
      editorActiveLineNumber: "#f8f8f2",
      success: "#50fa7b",
      warning: "#f1fa8c",
      error: "#ff5555",
      scrollbar: "#6272a466",
      selection: "#44475a",
    },
    light: {
      background: "#f8f8f2",
      surface: "#ffffff",
      elevated: "#f0f0eb",
      editor: "#ffffff",
      element: "#f0f0eb",
      elementHover: "#e4e4df",
      elementSelected: "#d8d8d3",
      border: "#d8d8d3",
      borderVariant: "#e4e4df",
      borderFocused: "#7c3aed",
      text: "#282a36",
      textMuted: "#44475a",
      textPlaceholder: "#6272a4",
      textAccent: "#7c3aed",
      editorFg: "#282a36",
      editorLineNumber: "#9ca0b0",
      editorActiveLineNumber: "#282a36",
      success: "#2a9d4a",
      warning: "#b58900",
      error: "#d63031",
      scrollbar: "#6272a44d",
      selection: "#bd93f933",
    },
  },
];

export const DEFAULT_THEME_ID: ThemeId = "cursor";
export const DEFAULT_APPEARANCE: Appearance = "dark";
export const THEME_STORAGE_KEY = "memo.theme";
export const APPEARANCE_STORAGE_KEY = "memo.appearance";

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function isAppearance(value: string): value is Appearance {
  return value === "dark" || value === "light";
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function faviconHref(tokens: Pick<
  ThemeTokens,
  "surface" | "elevated" | "border" | "textAccent"
>) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${tokens.surface}"/><rect x="7" y="6.5" width="18" height="19" rx="3.5" fill="${tokens.elevated}" stroke="${tokens.border}" stroke-width="1.2"/><path d="M11 12.5h10M11 16.5h10M11 20.5h6.5" stroke="${tokens.textAccent}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function updateFavicon(tokens: ThemeTokens) {
  if (typeof document === "undefined") return;

  const href = faviconHref(tokens);
  let link = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][data-memo-favicon]',
  );
  if (!link) {
    document
      .querySelectorAll('link[rel="icon"]:not([data-memo-favicon])')
      .forEach((node) => node.remove());
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.dataset.memoFavicon = "true";
    document.head.appendChild(link);
  }
  link.href = href;
}

type FaviconPalette = Pick<
  ThemeTokens,
  "surface" | "elevated" | "border" | "textAccent"
>;

/** Compact palette map for the blocking favicon boot script. */
export function faviconBootScript() {
  const palettes = Object.fromEntries(
    THEMES.map((theme) => [
      theme.id,
      {
        dark: {
          surface: theme.dark.surface,
          elevated: theme.dark.elevated,
          border: theme.dark.border,
          textAccent: theme.dark.textAccent,
        } satisfies FaviconPalette,
        light: {
          surface: theme.light.surface,
          elevated: theme.light.elevated,
          border: theme.light.border,
          textAccent: theme.light.textAccent,
        } satisfies FaviconPalette,
      },
    ]),
  );

  return `(()=>{try{var P=${JSON.stringify(palettes)};var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||${JSON.stringify(DEFAULT_THEME_ID)};var a=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})||${JSON.stringify(DEFAULT_APPEARANCE)};var p=(P[t]||P[${JSON.stringify(DEFAULT_THEME_ID)}])[a==="light"?"light":"dark"];var s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="'+p.surface+'"/><rect x="7" y="6.5" width="18" height="19" rx="3.5" fill="'+p.elevated+'" stroke="'+p.border+'" stroke-width="1.2"/><path d="M11 12.5h10M11 16.5h10M11 20.5h6.5" stroke="'+p.textAccent+'" stroke-width="1.8" stroke-linecap="round"/></svg>';var h='data:image/svg+xml,'+encodeURIComponent(s);var l=document.querySelector('link[rel="icon"][data-memo-favicon]');if(!l){document.querySelectorAll('link[rel="icon"]:not([data-memo-favicon])').forEach(function(n){n.remove()});l=document.createElement('link');l.rel='icon';l.type='image/svg+xml';l.setAttribute('data-memo-favicon','true');document.head.appendChild(l)}l.href=h}catch(e){}})();`;
}

export function applyTheme(id: ThemeId, appearance: Appearance = "dark") {
  const theme = getTheme(id);
  const tokens = appearance === "light" ? theme.light : theme.dark;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.appearance = appearance;
  root.style.colorScheme = appearance;
  root.style.setProperty("--c-background", tokens.background);
  root.style.setProperty("--c-surface", tokens.surface);
  root.style.setProperty("--c-elevated", tokens.elevated);
  root.style.setProperty("--c-editor", tokens.editor);
  root.style.setProperty("--c-element", tokens.element);
  root.style.setProperty("--c-element-hover", tokens.elementHover);
  root.style.setProperty("--c-element-selected", tokens.elementSelected);
  root.style.setProperty("--c-border", tokens.border);
  root.style.setProperty("--c-border-variant", tokens.borderVariant);
  root.style.setProperty("--c-border-focused", tokens.borderFocused);
  root.style.setProperty("--c-text", tokens.text);
  root.style.setProperty("--c-text-muted", tokens.textMuted);
  root.style.setProperty("--c-text-placeholder", tokens.textPlaceholder);
  root.style.setProperty("--c-text-accent", tokens.textAccent);
  root.style.setProperty("--c-editor-fg", tokens.editorFg);
  root.style.setProperty("--c-editor-line-number", tokens.editorLineNumber);
  root.style.setProperty(
    "--c-editor-active-line-number",
    tokens.editorActiveLineNumber,
  );
  root.style.setProperty("--c-success", tokens.success);
  root.style.setProperty("--c-warning", tokens.warning);
  root.style.setProperty("--c-error", tokens.error);
  root.style.setProperty("--c-scrollbar", tokens.scrollbar);
  root.style.setProperty("--c-selection", tokens.selection);
  updateFavicon(tokens);
}
