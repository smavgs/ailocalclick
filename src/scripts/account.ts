import {
  createClient,
  type Provider,
  type SupabaseClient,
  type User
} from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

export const LOCAL_SAVED_MODELS_KEY = "ailocalclick:saved-models:v1";
export const ACCOUNT_CHANGE_EVENT = "ailocalclick:account-change";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const validConfiguration = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)
  && supabasePublishableKey.length > 20;

const client: SupabaseClient<Database> | null = validConfiguration
  ? createClient<Database>(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export interface AccountProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
  preferredOs: "macos" | "windows" | "linux" | "other" | "";
  ramGb: number | null;
  gpuName: string;
  gpuMemoryGb: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedModelRecord {
  slug: string;
  name: string;
  selectedTag: string;
  personalNote: string;
  savedAt: string;
  updatedAt: string;
}

export interface AccountState {
  configured: boolean;
  ready: boolean;
  recovery: boolean;
  user: User | null;
  profile: AccountProfile | null;
  saved: Map<string, SavedModelRecord>;
  error: string;
}

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type SavedModelRow = Pick<
  Database["public"]["Tables"]["saved_models"]["Row"],
  "model_slug" | "model_name" | "selected_tag" | "personal_note" | "saved_at" | "updated_at"
>;

let state: AccountState = {
  configured: validConfiguration,
  ready: false,
  recovery: false,
  user: null,
  profile: null,
  saved: new Map(),
  error: ""
};
let initialization: Promise<void> | null = null;
let refreshVersion = 0;

export function validModelSlug(value: string | undefined): string | null {
  if (!value || value.length > 200) return null;
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(value) ? value : null;
}

function validTag(value: string): string | null {
  const tag = value.trim() || "latest";
  if (tag.length > 120) return null;
  return /^[a-z0-9][a-z0-9._-]*$/i.test(tag) ? tag : null;
}

export function readLocalSavedSlugs(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOCAL_SAVED_MODELS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.flatMap((value) => {
      if (typeof value !== "string") return [];
      const slug = validModelSlug(value);
      return slug ? [slug] : [];
    }));
  } catch {
    return new Set();
  }
}

function emitChange(): void {
  window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGE_EVENT));
}

function profileFromRow(row: ProfileRow): AccountProfile {
  const gpuMemory = row.gpu_memory_gb === null ? null : Number(row.gpu_memory_gb);
  const preferredOs = row.preferred_os;
  return {
    id: row.id,
    displayName: row.display_name ?? "",
    avatarUrl: row.avatar_url ?? "",
    preferredOs: preferredOs === "macos" || preferredOs === "windows" || preferredOs === "linux" || preferredOs === "other"
      ? preferredOs
      : "",
    ramGb: row.ram_gb,
    gpuName: row.gpu_name ?? "",
    gpuMemoryGb: Number.isFinite(gpuMemory) ? gpuMemory : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function savedFromRow(row: SavedModelRow): SavedModelRecord {
  return {
    slug: row.model_slug,
    name: row.model_name,
    selectedTag: row.selected_tag,
    personalNote: row.personal_note,
    savedAt: row.saved_at,
    updatedAt: row.updated_at
  };
}

async function loadForUser(user: User | null): Promise<void> {
  const version = ++refreshVersion;
  if (!client || !user) {
    state = {
      ...state,
      ready: true,
      user: null,
      profile: null,
      saved: new Map(),
      error: ""
    };
    emitChange();
    return;
  }

  state = { ...state, ready: false, user, error: "" };
  emitChange();

  const [profileResult, savedResult] = await Promise.all([
    client.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    client.from("saved_models").select("model_slug, model_name, selected_tag, personal_note, saved_at, updated_at").eq("user_id", user.id)
  ]);
  if (version !== refreshVersion) return;
  if (profileResult.error) throw profileResult.error;
  if (savedResult.error) throw savedResult.error;

  let profileRow = profileResult.data as ProfileRow | null;
  if (!profileRow) {
    const fallbackName = String(user.user_metadata.full_name ?? user.user_metadata.name ?? user.email?.split("@")[0] ?? "");
    const created = await client.from("profiles").upsert({
      id: user.id,
      display_name: fallbackName.slice(0, 80) || null,
      avatar_url: String(user.user_metadata.avatar_url ?? user.user_metadata.picture ?? "").slice(0, 2048) || null
    }).select("*").single();
    if (created.error) throw created.error;
    profileRow = created.data as ProfileRow;
  }

  const records = new Map<string, SavedModelRecord>();
  for (const rawRow of (savedResult.data ?? []) as SavedModelRow[]) {
    const row = savedFromRow(rawRow);
    records.set(row.slug, row);
  }
  state = {
    ...state,
    configured: true,
    ready: true,
    user,
    profile: profileFromRow(profileRow),
    saved: records,
    error: ""
  };
  emitChange();
}

function setAccountError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The account service is temporarily unavailable.";
  state = { ...state, ready: true, error: message };
  emitChange();
}

export async function initializeAccount(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    if (!client) {
      await loadForUser(null);
      return;
    }

    client.auth.onAuthStateChange((event, session) => {
      state = {
        ...state,
        recovery: event === "PASSWORD_RECOVERY" ? true : event === "SIGNED_OUT" ? false : state.recovery
      };
      emitChange();
      window.setTimeout(() => {
        void loadForUser(session?.user ?? null).catch(setAccountError);
      }, 0);
    });

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    await loadForUser(data.session?.user ?? null);
  })().catch(setAccountError);
  return initialization;
}

export function getAccountState(): AccountState {
  return state;
}

export function getSavedSlugs(): Set<string> {
  return new Set(state.saved.keys());
}

export function getLocalImportCount(): number {
  if (!state.user) return 0;
  let count = 0;
  for (const slug of readLocalSavedSlugs()) {
    if (!state.saved.has(slug)) count += 1;
  }
  return count;
}

function normalizedEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  return normalized;
}

function checkedPassword(password: string): string {
  if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
  if (password.length > 128) throw new Error("Keep your password under 128 characters.");
  return password;
}

export async function signInWithPassword(email: string, password: string, captchaToken?: string): Promise<void> {
  if (!client) throw new Error("Account sign-in is not configured yet.");
  const { error } = await client.auth.signInWithPassword({
    email: normalizedEmail(email),
    password: checkedPassword(password),
    options: captchaToken ? { captchaToken } : undefined
  });
  if (error) throw error;
}

export async function signUpWithPassword(email: string, password: string, redirectTo: string, captchaToken?: string): Promise<{ needsConfirmation: boolean }> {
  if (!client) throw new Error("Account sign-up is not configured yet.");
  const { data, error } = await client.auth.signUp({
    email: normalizedEmail(email),
    password: checkedPassword(password),
    options: {
      emailRedirectTo: redirectTo,
      captchaToken
    }
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function requestPasswordReset(email: string, redirectTo: string, captchaToken?: string): Promise<void> {
  if (!client) throw new Error("Account recovery is not configured yet.");
  const { error } = await client.auth.resetPasswordForEmail(normalizedEmail(email), { redirectTo, captchaToken });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  if (!client || !state.user) throw new Error("Open the password reset link from your email first.");
  const { error } = await client.auth.updateUser({ password: checkedPassword(password) });
  if (error) throw error;
  state = { ...state, recovery: false, error: "" };
  emitChange();
}

export async function signInWithProvider(provider: "google" | "github", redirectTo: string): Promise<void> {
  if (!client) throw new Error("Account sign-in is not configured yet.");
  const { error } = await client.auth.signInWithOAuth({
    provider: provider as Provider,
    options: { redirectTo }
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function toggleSavedModel(slugValue: string, nameValue: string): Promise<boolean> {
  const slug = validModelSlug(slugValue);
  if (!slug) throw new Error("That model name is not valid.");
  const name = nameValue.trim().slice(0, 200) || slug;
  const existing = state.saved.get(slug);

  const user = state.user;
  if (!user || !client) {
    throw new Error("Sign in to save models to your private list.");
  }

  const previous = new Map(state.saved);
  if (existing) {
    state.saved.delete(slug);
    state = { ...state, saved: new Map(state.saved) };
    emitChange();
    const result = await client.from("saved_models").delete().eq("user_id", user.id).eq("model_slug", slug);
    if (result.error) {
      state = { ...state, saved: previous };
      emitChange();
      throw result.error;
    }
    return false;
  }

  const now = new Date().toISOString();
  const optimistic: SavedModelRecord = {
    slug,
    name,
    selectedTag: "latest",
    personalNote: "",
    savedAt: now,
    updatedAt: now
  };
  state.saved.set(slug, optimistic);
  state = { ...state, saved: new Map(state.saved) };
  emitChange();

  const result = await client.from("saved_models").upsert({
    user_id: user.id,
    model_slug: slug,
    model_name: name,
    selected_tag: "latest",
    personal_note: ""
  }, { onConflict: "user_id,model_slug" }).select("model_slug, model_name, selected_tag, personal_note, saved_at, updated_at").single();
  if (result.error) {
    state = { ...state, saved: previous };
    emitChange();
    throw result.error;
  }
  const saved = savedFromRow(result.data as SavedModelRow);
  state.saved.set(saved.slug, saved);
  state = { ...state, saved: new Map(state.saved) };
  emitChange();
  return true;
}

export async function updateSavedModel(slugValue: string, selectedTagValue: string, personalNoteValue: string): Promise<void> {
  if (!client || !state.user) throw new Error("Sign in to save tags and notes to your profile.");
  const slug = validModelSlug(slugValue);
  const selectedTag = validTag(selectedTagValue);
  const personalNote = personalNoteValue.trim();
  if (!slug || !selectedTag) throw new Error("Use a valid Ollama tag, such as latest, 7b, or q4_K_M.");
  if (personalNote.length > 4000) throw new Error("Keep notes under 4,000 characters.");

  const result = await client.from("saved_models").update({
    selected_tag: selectedTag,
    personal_note: personalNote
  }).eq("user_id", state.user.id).eq("model_slug", slug)
    .select("model_slug, model_name, selected_tag, personal_note, saved_at, updated_at").single();
  if (result.error) throw result.error;
  const saved = savedFromRow(result.data as SavedModelRow);
  state.saved.set(saved.slug, saved);
  state = { ...state, saved: new Map(state.saved) };
  emitChange();
}

export async function clearSavedModels(): Promise<void> {
  const user = state.user;
  if (!client || !user) {
    throw new Error("Sign in before clearing saved models.");
  }
  const previous = new Map(state.saved);
  state = { ...state, saved: new Map() };
  emitChange();
  const result = await client.from("saved_models").delete().eq("user_id", user.id);
  if (result.error) {
    state = { ...state, saved: previous };
    emitChange();
    throw result.error;
  }
}

export async function importLocalModels(models: Array<{ slug: string; name: string }>): Promise<number> {
  if (!client || !state.user) throw new Error("Sign in before importing saved models.");
  const rows = models.flatMap((model) => {
    const slug = validModelSlug(model.slug);
    if (!slug || state.saved.has(slug)) return [];
    return [{
      user_id: state.user!.id,
      model_slug: slug,
      model_name: model.name.trim().slice(0, 200) || slug,
      selected_tag: "latest",
      personal_note: ""
    }];
  });
  if (rows.length > 0) {
    const result = await client.from("saved_models").upsert(rows, { onConflict: "user_id,model_slug" });
    if (result.error) throw result.error;
  }
  localStorage.removeItem(LOCAL_SAVED_MODELS_KEY);
  await loadForUser(state.user);
  return rows.length;
}

export async function updateProfile(input: {
  displayName: string;
  avatarUrl: string;
  preferredOs: string;
  ramGb: number | null;
  gpuName: string;
  gpuMemoryGb: number | null;
}): Promise<void> {
  if (!client || !state.user) throw new Error("Sign in before updating your profile.");
  const displayName = input.displayName.trim();
  const avatarUrl = input.avatarUrl.trim();
  const preferredOs = new Set(["macos", "windows", "linux", "other"]).has(input.preferredOs)
    ? input.preferredOs
    : null;
  if (displayName.length > 80) throw new Error("Keep your name under 80 characters.");
  if (avatarUrl.length > 2048) throw new Error("The avatar URL is too long.");
  if (input.ramGb !== null && (!Number.isInteger(input.ramGb) || input.ramGb < 1 || input.ramGb > 4096)) {
    throw new Error("Enter RAM as a whole number between 1 and 4096 GB.");
  }
  if (input.gpuName.trim().length > 120) throw new Error("Keep the GPU name under 120 characters.");
  if (input.gpuMemoryGb !== null && (!Number.isFinite(input.gpuMemoryGb) || input.gpuMemoryGb < 0 || input.gpuMemoryGb > 4096)) {
    throw new Error("Enter GPU memory between 0 and 4096 GB.");
  }

  const result = await client.from("profiles").upsert({
    id: state.user.id,
    display_name: displayName || null,
    avatar_url: avatarUrl || null,
    preferred_os: preferredOs,
    ram_gb: input.ramGb,
    gpu_name: input.gpuName.trim() || null,
    gpu_memory_gb: input.gpuMemoryGb
  }).select("*").single();
  if (result.error) throw result.error;
  state = { ...state, profile: profileFromRow(result.data as ProfileRow) };
  emitChange();
}

export async function uploadAvatar(file: File): Promise<string> {
  if (!client || !state.user) throw new Error("Sign in before uploading an avatar.");
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("Choose a JPG, PNG, WebP, or GIF image.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Keep the avatar under 2 MB.");
  const path = `${state.user.id}/avatar.${extension}`;
  const uploaded = await client.storage.from("avatars").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: true
  });
  if (uploaded.error) throw uploaded.error;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
