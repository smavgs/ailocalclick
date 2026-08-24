import type { MessageMap } from "../i18n/types";

export type SupportedLocale = "en" | "ru" | "ko" | "ja" | "zh-CN";

export const LANGUAGE_CHANGE_EVENT = "ailocalclick:language-change";

const LANGUAGE_KEY = "ailocalclick:language:v1";
const supportedLocales = new Set<SupportedLocale>(["en", "ru", "ko", "ja", "zh-CN"]);
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatableAttributes = ["aria-label", "placeholder", "title"];

let locale: SupportedLocale = "en";
let messages: MessageMap = {};
let localeRequest = 0;

function supportedLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  if (supportedLocales.has(value as SupportedLocale)) return value as SupportedLocale;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("en")) return "en";
  return null;
}

async function loadMessages(nextLocale: SupportedLocale): Promise<MessageMap> {
  if (nextLocale === "en") return {};
  if (nextLocale === "ru") return (await import("../i18n/ru")).default;
  if (nextLocale === "ko") return (await import("../i18n/ko")).default;
  if (nextLocale === "ja") return (await import("../i18n/ja")).default;
  return (await import("../i18n/zh-CN")).default;
}

function withVariables(value: string, variables: Record<string, string | number>): string {
  let result = value;
  for (const [key, replacement] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, String(replacement));
  }
  return result;
}

export function tr(source: string, variables: Record<string, string | number> = {}): string {
  return withVariables(messages[source] ?? source, variables);
}

export function getLocale(): SupportedLocale {
  return locale;
}

function shouldSkip(element: Element | null): boolean {
  return Boolean(element?.closest([
    "[data-i18n-skip]",
    "script",
    "style",
    "head",
    "code",
    "pre",
    ".model-copy h3",
    ".model-copy > p",
    ".model-hero h1",
    ".model-hero > div:first-child > p:not(.eyebrow)",
    "[data-account-name]",
    "[data-account-email-display]",
    "[data-profile-summary-name]",
    "[data-profile-email]"
  ].join(",")));
}

function translatedWhitespace(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = tr(trimmed);
  if (translated === trimmed) return value;
  const start = value.match(/^\s*/)?.[0] ?? "";
  const end = value.match(/\s*$/)?.[0] ?? "";
  return `${start}${translated}${end}`;
}

export function refreshTranslations(root: ParentNode = document): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (!shouldSkip(text.parentElement)) {
      if (!originalText.has(text)) originalText.set(text, text.data);
      text.data = translatedWhitespace(originalText.get(text) ?? text.data);
    }
    node = walker.nextNode();
  }

  for (const element of root.querySelectorAll<Element>(translatableAttributes.map((name) => `[${name}]`).join(","))) {
    if (shouldSkip(element)) continue;
    let originals = originalAttributes.get(element);
    if (!originals) {
      originals = new Map();
      originalAttributes.set(element, originals);
    }
    for (const name of translatableAttributes) {
      const current = element.getAttribute(name);
      if (current === null) continue;
      if (!originals.has(name)) originals.set(name, current);
      element.setAttribute(name, tr(originals.get(name) ?? current));
    }
  }

  const originalTitle = document.documentElement.dataset.englishTitle ?? document.title;
  document.documentElement.dataset.englishTitle = originalTitle;
  const modelTitle = originalTitle.match(/^(.*) — Copy & run with Ollama \| ailocal\.click$/);
  document.title = modelTitle?.[1]
    ? `${modelTitle[1]} — ${tr("Copy & run with Ollama")} | ailocal.click`
    : tr(originalTitle);
}

export async function setLocale(nextLocale: SupportedLocale): Promise<void> {
  const request = ++localeRequest;
  const nextMessages = await loadMessages(nextLocale);
  if (request !== localeRequest) return;
  messages = nextMessages;
  locale = nextLocale;
  document.documentElement.lang = nextLocale;
  document.documentElement.dir = "ltr";
  const selector = document.querySelector<HTMLSelectElement>("[data-language-select]");
  if (selector) selector.value = nextLocale;
  try {
    localStorage.setItem(LANGUAGE_KEY, nextLocale);
  } catch {
    // Language still works when storage is blocked.
  }
  refreshTranslations();
  window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { locale: nextLocale } }));
}

export async function initializeI18n(): Promise<void> {
  const selector = document.querySelector<HTMLSelectElement>("[data-language-select]");
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANGUAGE_KEY);
  } catch {
    // Use browser language when storage is blocked.
  }
  const initial = supportedLocale(stored)
    ?? navigator.languages.map((value) => supportedLocale(value)).find(Boolean)
    ?? "en";
  if (selector) {
    selector.addEventListener("change", () => {
      const selected = supportedLocale(selector.value) ?? "en";
      void setLocale(selected);
    });
  }
  await setLocale(initial);
}
