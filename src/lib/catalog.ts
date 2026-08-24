import catalogJson from "../data/models.json";

export interface Model {
  slug: string;
  name: string;
  description: string;
  capabilities: string[];
  sizes: string[];
  pulls: string;
  pullCount: number;
  tagCount: number;
  updatedAt: string | null;
  updatedLabel: string;
  officialUrl: string;
  runCommand: string;
}

export interface CatalogSource {
  name: string;
  url: string;
  generatedAt: string;
  modelCount: number;
  scope: string;
}

export interface Catalog {
  source: CatalogSource;
  models: Model[];
}

export const catalog = catalogJson as Catalog;
export const models = catalog.models;

export const capabilityLabels: Record<string, string> = {
  vision: "Vision",
  tools: "Tools",
  thinking: "Thinking",
  embedding: "Embedding",
  cloud: "Cloud",
  audio: "Audio"
};

export const capabilityDefinitions: Record<string, string> = {
  vision: "Understands images and other supported visual input.",
  tools: "Can request compatible functions and external tools.",
  thinking: "Supports model reasoning controls through Ollama.",
  embedding: "Turns text into vectors for retrieval, search, and RAG.",
  cloud: "Runs through Ollama's cloud rather than entirely on this computer.",
  audio: "Accepts audio on supported model variants."
};

export function formatSyncDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

export function formatUpdatedDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC"
  }).format(new Date(value));
}
