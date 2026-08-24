import type { MessageMap } from "../i18n/types";

export type SupportedLocale = "en" | "ru" | "ko" | "ja" | "zh-CN";

export const LANGUAGE_CHANGE_EVENT = "ailocalclick:language-change";

const LANGUAGE_KEY = "ailocalclick:language:v1";
const supportedLocales = new Set<SupportedLocale>(["en", "ru", "ko", "ja", "zh-CN"]);
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const originalModelDescriptions = new WeakMap<Element, string>();
const translatableAttributes = ["aria-label", "placeholder", "title"];

let locale: SupportedLocale = "en";
let messages: MessageMap = {};
let modelDescriptions: Record<string, ModelDescriptionEntry> = {};
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

interface ModelDescriptionEntry {
  source: string;
  sourceHash: string;
  text: string;
}

const modelDescriptionFallbacks: Record<Exclude<SupportedLocale, "en">, string> = {
  ru: "Перевод описания этой модели обновляется. Точные сведения смотрите на официальной странице Ollama.",
  ko: "이 모델의 번역 설명을 업데이트하고 있습니다. 정확한 정보는 공식 Ollama 페이지에서 확인하세요.",
  ja: "このモデルの翻訳説明は更新中です。正確な情報はOllama公式ページでご確認ください。",
  "zh-CN": "该模型的翻译说明正在更新中。准确信息请查看 Ollama 官方页面。"
};

async function loadModelDescriptions(nextLocale: SupportedLocale): Promise<Record<string, ModelDescriptionEntry>> {
  if (nextLocale === "en") return {};
  const entries: Record<string, ModelDescriptionEntry> = nextLocale === "ru"
    ? (await import("../i18n/model-descriptions/ru.json")).default
    : nextLocale === "ko"
      ? (await import("../i18n/model-descriptions/ko.json")).default
      : nextLocale === "ja"
        ? (await import("../i18n/model-descriptions/ja.json")).default
        : (await import("../i18n/model-descriptions/zh-CN.json")).default;
  return entries;
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

  for (const element of root.querySelectorAll<HTMLElement>("[data-model-description][data-model-slug]")) {
    if (!originalModelDescriptions.has(element)) {
      originalModelDescriptions.set(element, element.textContent ?? "");
    }
    const source = originalModelDescriptions.get(element) ?? element.textContent ?? "";
    const slug = element.dataset.modelSlug ?? "";
    const entry = modelDescriptions[slug];
    element.textContent = locale === "en"
      ? source
      : entry?.source === source
        ? entry.text
        : modelDescriptionFallbacks[locale];
    const row = element.closest<HTMLElement>("[data-model-row]");
    if (row) {
      row.dataset.search = [row.dataset.name, element.textContent, row.dataset.caps, row.dataset.modelSizes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
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
  const [nextMessages, nextModelDescriptions] = await Promise.all([
    loadMessages(nextLocale),
    loadModelDescriptions(nextLocale)
  ]);
  if (request !== localeRequest) return;
  messages = nextMessages;
  modelDescriptions = nextModelDescriptions;
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
  updateHomepageLocalePath(nextLocale);
  refreshTranslations();
  window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { locale: nextLocale } }));
}

function updateHomepageLocalePath(nextLocale: SupportedLocale): void {
  const basePath = document.documentElement.dataset.basePath ?? "";
  const path = window.location.pathname.slice(basePath.length) || "/";
  if (!/^\/(?:ru|ko|ja|zh-cn)?\/?$/i.test(path)) return;
  const localePath = nextLocale === "en" ? "/" : `/${nextLocale.toLowerCase()}/`;
  const next = new URL(window.location.href);
  next.pathname = `${basePath}${localePath}`.replace(/\/+/g, "/");
  window.history.replaceState({}, "", next);
}

export async function initializeI18n(): Promise<void> {
  const selector = document.querySelector<HTMLSelectElement>("[data-language-select]");
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANGUAGE_KEY);
  } catch {
    // Use browser language when storage is blocked.
  }
  const routeLocale = supportedLocale(document.documentElement.dataset.localeRoute);
  const initial = routeLocale
    ?? supportedLocale(stored)
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
