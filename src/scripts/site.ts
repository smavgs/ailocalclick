import {
  ACCOUNT_CHANGE_EVENT,
  clearSavedModels,
  getAccountState,
  getLocalImportCount,
  importLocalModels,
  initializeAccount,
  readLocalSavedSlugs,
  signInWithEmail,
  signInWithProvider,
  signOut,
  toggleSavedModel,
  updateProfile,
  updateSavedModel,
  uploadAvatar,
  type AccountProfile,
  type SavedModelRecord
} from "./account";

const toast = document.querySelector<HTMLElement>("[data-toast]");
const DEFAULT_OLLAMA_API = "http://localhost:11434/api";
let toastTimer: number | undefined;

interface PullModel {
  slug: string;
  name: string;
  runCommand: string;
  officialUrl: string;
  cloud: boolean;
}

interface PullMessage {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

function showToast(message: string, duration = 1800): void {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const legacyDocument = document as unknown as { execCommand(commandId: string): boolean };
    const copied = legacyDocument.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function validModelSlug(value: string | undefined): string | null {
  if (!value || value.length > 200) return null;
  return /^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9][a-z0-9._-]*)?$/i.test(value) ? value : null;
}

function updateSavedUi(): void {
  const saved = new Set(getAccountState().saved.keys());
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-save-model]")) {
    const slug = validModelSlug(button.dataset.saveModel);
    if (!slug) continue;
    const isSaved = saved.has(slug);
    const isSavedList = button.closest<HTMLElement>('[data-saved-only="true"]') !== null;
    button.setAttribute("aria-pressed", String(isSaved));
    button.classList.toggle("is-saved", isSaved);
    button.textContent = isSaved ? (isSavedList ? "Remove" : "Saved") : "Save";
  }

  for (const count of document.querySelectorAll<HTMLElement>("[data-saved-count]")) {
    count.textContent = String(saved.size);
    count.hidden = saved.size === 0;
  }
}

function setupSavedPage(): void {
  const root = document.querySelector<HTMLElement>("[data-saved-page]");
  if (!root) return;

  const search = root.querySelector<HTMLInputElement>("[data-saved-search]");
  const capability = root.querySelector<HTMLSelectElement>("[data-saved-capability]");
  const sort = root.querySelector<HTMLSelectElement>("[data-saved-sort]");
  const list = root.querySelector<HTMLElement>("[data-saved-model-list]");
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-model-row]"));
  const count = root.querySelector<HTMLElement>("[data-saved-page-count]");
  const label = root.querySelector<HTMLElement>("[data-saved-page-label]");
  const loading = root.querySelector<HTMLElement>("[data-saved-loading]");
  const empty = root.querySelector<HTMLElement>("[data-saved-empty]");
  const emptyMessage = root.querySelector<HTMLElement>("[data-saved-empty-message]");
  const exportButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-export-saved]"));
  const clearButton = root.querySelector<HTMLButtonElement>("[data-clear-saved]");
  const mode = root.querySelector<HTMLElement>("[data-saved-mode]");
  const modeSignIn = root.querySelector<HTMLButtonElement>("[data-saved-mode-line] [data-auth-open]");
  const privacy = root.querySelector<HTMLElement>("[data-saved-privacy]");
  const importPanel = root.querySelector<HTMLElement>("[data-saved-import]");
  const importCount = root.querySelector<HTMLElement>("[data-local-import-count]");
  const importButton = root.querySelector<HTMLButtonElement>("[data-import-local]");
  if (!search || !capability || !sort || !list || !count || !label || !loading || !empty || !emptyMessage || exportButtons.length === 0 || !clearButton || !mode || !modeSignIn || !privacy || !importPanel || !importCount || !importButton) return;

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  const exactSlug = (baseSlug: string, tag: string): string => tag && tag !== "latest" ? `${baseSlug}:${tag}` : baseSlug;

  const modelScale = (tag: string, sizes: string): number | null => {
    const values = tag === "latest" ? sizes.split(" ") : [tag];
    for (const value of values) {
      const match = value.match(/(?:^|[-_])(\d+(?:\.\d+)?)b(?:$|[-_])/i) ?? value.match(/^(\d+(?:\.\d+)?)b$/i);
      if (match?.[1]) return Number(match[1]);
    }
    return null;
  };

  const compatibilityText = (row: HTMLElement, record: SavedModelRecord, profile: AccountProfile | null): string => {
    if ((row.dataset.caps ?? "").split(" ").includes("cloud") && !(row.dataset.modelSizes ?? "").trim()) {
      return "Cloud model: local RAM is not the primary limit. Check Ollama account requirements.";
    }
    if (!profile || (profile.ramGb === null && profile.gpuMemoryGb === null)) {
      return "Add RAM or GPU memory in your profile for a rough compatibility guide.";
    }
    const scale = modelScale(record.selectedTag, row.dataset.modelSizes ?? "");
    const hardware = profile.preferredOs === "macos"
      ? profile.ramGb
      : Math.max(profile.ramGb ?? 0, profile.gpuMemoryGb ?? 0) || null;
    if (scale === null || hardware === null) {
      return "Hardware profile saved. Confirm this exact tag’s file size and quantization on Ollama.";
    }
    const roughNeed = Math.ceil(scale * 0.75 + 4);
    if (hardware >= roughNeed * 1.25) {
      return `Likely a practical starting point for your ${hardware} GB profile with a compact quantization. Verify the exact tag size.`;
    }
    if (hardware >= roughNeed) {
      return `May fit your ${hardware} GB profile, but context length and quantization can change memory use. Verify before pulling.`;
    }
    return `This ${record.selectedTag} selection may be tight for your ${hardware} GB profile. Consider a smaller tag and verify its file size.`;
  };

  const updateRowDetails = (row: HTMLElement, record: SavedModelRecord, signedIn: boolean, profile: AccountProfile | null): void => {
    const tagInput = row.querySelector<HTMLInputElement>("[data-saved-tag]");
    const noteInput = row.querySelector<HTMLTextAreaElement>("[data-saved-note]");
    const detailButton = row.querySelector<HTMLButtonElement>("[data-save-details]");
    const guidance = row.querySelector<HTMLElement>("[data-fit-guidance]");
    const pullTrigger = row.querySelector<HTMLElement>("[data-open-pull]");
    const command = row.querySelector<HTMLElement>(".row-command > code");
    if (!tagInput || !noteInput || !detailButton || !guidance || !pullTrigger || !command) return;
    if (document.activeElement !== tagInput) tagInput.value = record.selectedTag;
    if (document.activeElement !== noteInput) noteInput.value = record.personalNote;
    tagInput.disabled = !signedIn;
    noteInput.disabled = !signedIn;
    detailButton.disabled = !signedIn;
    detailButton.textContent = signedIn ? "Update details" : "Sign in for tags & notes";
    guidance.textContent = compatibilityText(row, record, profile);

    const baseSlug = row.dataset.modelSlug ?? record.slug;
    const chosenSlug = exactSlug(baseSlug, record.selectedTag);
    const runCommand = `ollama run ${chosenSlug}`;
    pullTrigger.dataset.modelSlug = chosenSlug;
    pullTrigger.dataset.runCommand = runCommand;
    command.textContent = runCommand;
  };

  const exportedModels = (): Array<Record<string, string>> => {
    const state = getAccountState();
    return rows.flatMap((row) => {
      const slug = validModelSlug(row.dataset.modelSlug);
      if (!slug) return [];
      const record = state.saved.get(slug);
      if (!record) return [];
      const exact = exactSlug(slug, record.selectedTag);
      return [{
        slug,
        name: row.dataset.modelName ?? record.name,
        selectedTag: record.selectedTag,
        command: `ollama run ${exact}`,
        personalNote: record.personalNote,
        officialUrl: row.dataset.modelUrl ?? `https://ollama.com/library/${slug}`,
        savedAt: record.savedAt,
        updatedAt: record.updatedAt
      }];
    });
  };

  const download = (contents: string, type: string, extension: string): void => {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ailocalclick-saved-models-${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const apply = (): void => {
    const account = getAccountState();
    const query = search.value.trim().toLowerCase();
    const selectedCapability = capability.value;
    const selectedSort = sort.value;
    const visible: HTMLElement[] = [];

    mode.textContent = !account.ready
      ? "Checking your account…"
      : account.user
        ? `Synced privately as ${account.user.email ?? "your account"}`
        : "Saved on this device";
    modeSignIn.hidden = Boolean(account.user);
    privacy.textContent = account.user
      ? "Saved models, selected tags, notes, and profile preferences are synchronized as private records for this account."
      : "Guest saves use this browser’s local storage. Sign in to sync them and add selected tags, notes, and hardware guidance.";

    const localCount = getLocalImportCount();
    importCount.textContent = String(localCount);
    importPanel.hidden = !account.user || localCount === 0;

    for (const row of rows) {
      const slug = validModelSlug(row.dataset.modelSlug);
      const record = slug ? account.saved.get(slug) : undefined;
      const matchesSearch = !query || (row.dataset.search ?? "").includes(query)
        || Boolean(record?.personalNote.toLowerCase().includes(query))
        || Boolean(record?.selectedTag.toLowerCase().includes(query));
      const matchesCapability = selectedCapability === "all"
        || (row.dataset.caps ?? "").split(" ").includes(selectedCapability);
      row.hidden = !(record && matchesSearch && matchesCapability);
      if (record) updateRowDetails(row, record, Boolean(account.user), account.profile);
      if (!row.hidden) visible.push(row);
    }

    const sorted = [...rows].sort((a, b) => {
      const aSlug = validModelSlug(a.dataset.modelSlug);
      const bSlug = validModelSlug(b.dataset.modelSlug);
      const aRecord = aSlug ? account.saved.get(aSlug) : undefined;
      const bRecord = bSlug ? account.saved.get(bSlug) : undefined;
      if (selectedSort === "name") return collator.compare(a.dataset.modelName ?? "", b.dataset.modelName ?? "");
      if (selectedSort === "tag") return collator.compare(aRecord?.selectedTag ?? "", bRecord?.selectedTag ?? "");
      return Date.parse(bRecord?.savedAt ?? "0") - Date.parse(aRecord?.savedAt ?? "0");
    });
    list.append(...sorted);

    count.textContent = String(visible.length);
    label.textContent = visible.length === 1 ? "model" : "models";
    loading.hidden = account.ready;
    empty.hidden = !account.ready || visible.length > 0;
    emptyMessage.textContent = account.saved.size === 0
      ? "Your saved list is empty."
      : "No saved models match those filters.";
    for (const button of exportButtons) button.disabled = account.saved.size === 0;
    clearButton.disabled = account.saved.size === 0;
  };

  search.addEventListener("input", apply);
  capability.addEventListener("change", apply);
  sort.addEventListener("change", apply);
  for (const exportButton of exportButtons) {
    exportButton.addEventListener("click", () => {
      const models = exportedModels();
      if (exportButton.dataset.exportSaved === "csv") {
        const cell = (value: string): string => `"${value.replaceAll('"', '""')}"`;
        const header = ["name", "slug", "selected_tag", "command", "personal_note", "official_url", "saved_at"];
        const lines = models.map((model) => [
          model.name ?? "",
          model.slug ?? "",
          model.selectedTag ?? "latest",
          model.command ?? "",
          model.personalNote ?? "",
          model.officialUrl ?? "",
          model.savedAt ?? ""
        ].map(cell).join(","));
        download([header.join(","), ...lines].join("\n"), "text/csv;charset=utf-8", "csv");
      } else {
        download(JSON.stringify({
          exportedAt: new Date().toISOString(),
          source: "ailocal.click",
          accountSynced: Boolean(getAccountState().user),
          models
        }, null, 2), "application/json", "json");
      }
      showToast(`Exported ${models.length} saved ${models.length === 1 ? "model" : "models"}`);
    });
  }
  clearButton.addEventListener("click", async () => {
    const location = getAccountState().user ? "your private account" : "this browser";
    if (!window.confirm(`Remove every saved model from ${location}?`)) return;
    clearButton.disabled = true;
    try {
      await clearSavedModels();
      showToast("Saved list cleared");
    } catch (error) {
      showToast(errorMessage(error), 3600);
    } finally {
      apply();
    }
  });

  importButton.addEventListener("click", async () => {
    const local = readLocalSavedSlugs();
    const models = rows.flatMap((row) => {
      const slug = validModelSlug(row.dataset.modelSlug);
      if (!slug || !local.has(slug)) return [];
      return [{ slug, name: row.dataset.modelName ?? slug }];
    });
    importButton.disabled = true;
    try {
      const imported = await importLocalModels(models);
      showToast(`Imported ${imported} local ${imported === 1 ? "model" : "models"} to your profile`, 3200);
    } catch (error) {
      showToast(errorMessage(error), 3600);
    } finally {
      importButton.disabled = false;
      apply();
    }
  });

  root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const detailsButton = target.closest<HTMLButtonElement>("[data-save-details]");
    if (!detailsButton) return;
    const row = detailsButton.closest<HTMLElement>("[data-model-row]");
    const slug = validModelSlug(row?.dataset.modelSlug);
    const tag = row?.querySelector<HTMLInputElement>("[data-saved-tag]");
    const note = row?.querySelector<HTMLTextAreaElement>("[data-saved-note]");
    if (!row || !slug || !tag || !note) return;
    detailsButton.disabled = true;
    detailsButton.textContent = "Saving…";
    try {
      await updateSavedModel(slug, tag.value, note.value);
      showToast(`${row.dataset.modelName ?? slug} details updated`);
    } catch (error) {
      showToast(errorMessage(error), 3800);
    } finally {
      apply();
    }
  });

  window.addEventListener(ACCOUNT_CHANGE_EVENT, apply);
  apply();
}

function setAvatar(element: HTMLElement, avatarUrl: string, name: string): void {
  const initial = name.trim().charAt(0).toUpperCase() || "A";
  element.textContent = avatarUrl ? "" : initial;
  element.style.backgroundImage = avatarUrl ? `url(${JSON.stringify(avatarUrl)})` : "";
  element.classList.toggle("has-image", Boolean(avatarUrl));
}

function accountName(): string {
  const account = getAccountState();
  return account.profile?.displayName
    || String(account.user?.user_metadata.full_name ?? account.user?.user_metadata.name ?? "")
    || account.user?.email?.split("@")[0]
    || "Your account";
}

function accountRedirectUrl(): string {
  const basePath = document.documentElement.dataset.basePath ?? "";
  return `${window.location.origin}${basePath}/profile/`;
}

function setupAccountUi(): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-account-dialog]");
  if (!dialog) return;
  const loading = dialog.querySelector<HTMLElement>("[data-account-loading]");
  const guest = dialog.querySelector<HTMLElement>("[data-account-guest]");
  const member = dialog.querySelector<HTMLElement>("[data-account-member]");
  const unavailable = dialog.querySelector<HTMLElement>("[data-account-unavailable]");
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-account-close]");
  const emailForm = dialog.querySelector<HTMLFormElement>("[data-account-email-form]");
  const emailInput = dialog.querySelector<HTMLInputElement>("[data-account-email]");
  const emailSubmit = dialog.querySelector<HTMLButtonElement>("[data-account-email-submit]");
  const guestMessage = dialog.querySelector<HTMLElement>("[data-account-message]");
  const memberMessage = dialog.querySelector<HTMLElement>("[data-account-member-message]");
  const memberName = dialog.querySelector<HTMLElement>("[data-account-name]");
  const memberEmail = dialog.querySelector<HTMLElement>("[data-account-email-display]");
  const memberAvatar = dialog.querySelector<HTMLElement>("[data-account-avatar]");
  const signOutButton = dialog.querySelector<HTMLButtonElement>("[data-account-sign-out]");
  if (!loading || !guest || !member || !unavailable || !closeButton || !emailForm || !emailInput || !emailSubmit || !guestMessage || !memberMessage || !memberName || !memberEmail || !memberAvatar || !signOutButton) return;

  const render = (): void => {
    const account = getAccountState();
    const name = accountName();
    const avatarUrl = account.profile?.avatarUrl
      || String(account.user?.user_metadata.avatar_url ?? account.user?.user_metadata.picture ?? "");

    for (const trigger of document.querySelectorAll<HTMLElement>("[data-account-trigger]")) {
      trigger.classList.toggle("is-signed-in", Boolean(account.user));
    }
    for (const label of document.querySelectorAll<HTMLElement>("[data-account-trigger-label]")) {
      label.textContent = account.user ? "Profile" : "Sign in";
    }
    for (const avatar of document.querySelectorAll<HTMLElement>("[data-header-avatar]")) {
      avatar.hidden = !account.user;
      if (account.user) setAvatar(avatar, avatarUrl, name);
    }

    loading.hidden = account.ready || !account.configured;
    unavailable.hidden = account.configured;
    guest.hidden = !account.ready || !account.configured || Boolean(account.user);
    member.hidden = !account.ready || !account.user;
    guestMessage.textContent = !account.user ? account.error : "";
    memberMessage.textContent = account.user ? account.error : "";
    if (account.user) {
      memberName.textContent = name;
      memberEmail.textContent = account.user.email ?? "Signed-in account";
      setAvatar(memberAvatar, avatarUrl, name);
    }
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-auth-open]")) return;
    event.preventDefault();
    render();
    if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
  });

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    emailSubmit.disabled = true;
    emailSubmit.textContent = "Sending…";
    guestMessage.textContent = "";
    try {
      await signInWithEmail(emailInput.value, accountRedirectUrl());
      guestMessage.textContent = "Check your email and open the secure sign-in link on this device.";
      emailInput.value = "";
    } catch (error) {
      guestMessage.textContent = errorMessage(error);
    } finally {
      emailSubmit.disabled = false;
      emailSubmit.textContent = "Send sign-in link";
    }
  });

  for (const providerButton of dialog.querySelectorAll<HTMLButtonElement>("[data-auth-provider]")) {
    providerButton.addEventListener("click", async () => {
      const provider = providerButton.dataset.authProvider;
      if (provider !== "google" && provider !== "apple") return;
      providerButton.disabled = true;
      guestMessage.textContent = "Opening the secure provider…";
      try {
        await signInWithProvider(provider, accountRedirectUrl());
      } catch (error) {
        providerButton.disabled = false;
        guestMessage.textContent = errorMessage(error);
      }
    });
  }

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    memberMessage.textContent = "Signing out…";
    try {
      await signOut();
      showToast("Signed out. Guest saves on this device are still available.");
    } catch (error) {
      memberMessage.textContent = errorMessage(error);
    } finally {
      signOutButton.disabled = false;
    }
  });

  window.addEventListener(ACCOUNT_CHANGE_EVENT, render);
  render();
}

function setupProfilePage(): void {
  const root = document.querySelector<HTMLElement>("[data-profile-page]");
  if (!root) return;
  const loading = root.querySelector<HTMLElement>("[data-profile-loading]");
  const signedOut = root.querySelector<HTMLElement>("[data-profile-signed-out]");
  const workspace = root.querySelector<HTMLElement>("[data-profile-workspace]");
  const form = root.querySelector<HTMLFormElement>("[data-profile-form]");
  const nameInput = root.querySelector<HTMLInputElement>("[data-profile-name]");
  const avatarInput = root.querySelector<HTMLInputElement>("[data-profile-avatar-file]");
  const osInput = root.querySelector<HTMLSelectElement>("[data-profile-os]");
  const ramInput = root.querySelector<HTMLInputElement>("[data-profile-ram]");
  const gpuInput = root.querySelector<HTMLInputElement>("[data-profile-gpu]");
  const gpuMemoryInput = root.querySelector<HTMLInputElement>("[data-profile-gpu-memory]");
  const submitButton = root.querySelector<HTMLButtonElement>("[data-profile-submit]");
  const status = root.querySelector<HTMLElement>("[data-profile-status]");
  const preview = root.querySelector<HTMLElement>("[data-profile-avatar-preview]");
  const summaryName = root.querySelector<HTMLElement>("[data-profile-summary-name]");
  const email = root.querySelector<HTMLElement>("[data-profile-email]");
  const savedCount = root.querySelector<HTMLElement>("[data-profile-saved-count]");
  const osSummary = root.querySelector<HTMLElement>("[data-profile-os-summary]");
  if (!loading || !signedOut || !workspace || !form || !nameInput || !avatarInput || !osInput || !ramInput || !gpuInput || !gpuMemoryInput || !submitButton || !status || !preview || !summaryName || !email || !savedCount || !osSummary) return;

  const osLabels: Record<string, string> = {
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    other: "Other"
  };
  let hydratedUser = "";
  let dirty = false;
  let previewUrl = "";
  let currentAvatarUrl = "";

  const render = (): void => {
    const account = getAccountState();
    loading.hidden = account.ready;
    signedOut.hidden = !account.ready || Boolean(account.user);
    workspace.hidden = !account.ready || !account.user;
    if (!account.user) {
      hydratedUser = "";
      return;
    }

    const profile = account.profile;
    const name = accountName();
    currentAvatarUrl = profile?.avatarUrl
      || String(account.user.user_metadata.avatar_url ?? account.user.user_metadata.picture ?? "");
    summaryName.textContent = name;
    email.textContent = account.user.email ?? "Signed-in account";
    savedCount.textContent = String(account.saved.size);
    osSummary.textContent = osLabels[profile?.preferredOs ?? ""] ?? "Not set";
    if (!previewUrl) setAvatar(preview, currentAvatarUrl, name);

    if (hydratedUser !== account.user.id || !dirty) {
      nameInput.value = profile?.displayName ?? name;
      osInput.value = profile?.preferredOs ?? "";
      ramInput.value = profile?.ramGb === null || profile?.ramGb === undefined ? "" : String(profile.ramGb);
      gpuInput.value = profile?.gpuName ?? "";
      gpuMemoryInput.value = profile?.gpuMemoryGb === null || profile?.gpuMemoryGb === undefined ? "" : String(profile.gpuMemoryGb);
      hydratedUser = account.user.id;
    }
    if (account.error) status.textContent = account.error;
  };

  form.addEventListener("input", () => {
    dirty = true;
  });

  avatarInput.addEventListener("change", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = avatarInput.files?.[0];
    previewUrl = file ? URL.createObjectURL(file) : "";
    setAvatar(preview, previewUrl || currentAvatarUrl, nameInput.value || accountName());
    dirty = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.textContent = "Saving…";
    status.textContent = "";
    try {
      const file = avatarInput.files?.[0];
      const avatarUrl = file ? await uploadAvatar(file) : currentAvatarUrl;
      const ramValue = ramInput.value.trim();
      const gpuMemoryValue = gpuMemoryInput.value.trim();
      await updateProfile({
        displayName: nameInput.value,
        avatarUrl,
        preferredOs: osInput.value,
        ramGb: ramValue ? Number(ramValue) : null,
        gpuName: gpuInput.value,
        gpuMemoryGb: gpuMemoryValue ? Number(gpuMemoryValue) : null
      });
      currentAvatarUrl = avatarUrl;
      dirty = false;
      avatarInput.value = "";
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = "";
      status.textContent = "Profile saved.";
      showToast("Profile saved");
    } catch (error) {
      status.textContent = errorMessage(error);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Save profile";
      render();
    }
  });

  window.addEventListener(ACCOUNT_CHANGE_EVENT, render);
  render();
}

function setupOriginHelp(): void {
  const origin = window.location.origin;
  for (const element of document.querySelectorAll<HTMLElement>("[data-site-origin]")) {
    element.textContent = origin;
  }

  const commands: Record<string, string> = {
    mac: `launchctl setenv OLLAMA_ORIGINS "${origin}"`,
    windows: `setx OLLAMA_ORIGINS "${origin}"`,
    linux: `Environment="OLLAMA_ORIGINS=${origin}"`
  };
  for (const [platform, command] of Object.entries(commands)) {
    for (const element of document.querySelectorAll<HTMLElement>(`[data-origin-command="${platform}"]`)) {
      element.textContent = command;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(`[data-copy-origin-command="${platform}"]`)) {
      button.dataset.copyCommand = command;
    }
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function readableStatus(status: string): string {
  if (status === "pulling manifest") return "Checking model files…";
  if (status.startsWith("pulling ")) return "Downloading model…";
  if (status.includes("verifying")) return "Verifying download…";
  if (status.includes("writing manifest")) return "Finishing setup…";
  if (status.includes("removing any unused layers")) return "Cleaning up…";
  if (status === "success") return "Download complete";
  return status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}…` : "Working…";
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "The request could not be completed. Check your connection and try again.";
}

function pullErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Ollama did not respond in time. Make sure it is open, then try again.";
  }
  if (error instanceof TypeError) {
    return `The browser could not reach local Ollama. Open Ollama first. If it is already open, allow ${window.location.origin} in OLLAMA_ORIGINS, restart Ollama, and permit local-network access if your browser asks.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return "The local Ollama connection failed. Copy the command or open the beginner connection guide.";
}

function setupPullDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-pull-dialog]");
  if (!dialog) return;

  const title = dialog.querySelector<HTMLElement>("[data-pull-title]");
  const command = dialog.querySelector<HTMLElement>("[data-pull-command]");
  const copyButton = dialog.querySelector<HTMLButtonElement>("[data-copy-command]");
  const saveButton = dialog.querySelector<HTMLButtonElement>("[data-save-model]");
  const official = dialog.querySelector<HTMLAnchorElement>("[data-pull-official]");
  const cloudNote = dialog.querySelector<HTMLElement>("[data-cloud-note]");
  const startButton = dialog.querySelector<HTMLButtonElement>("[data-pull-start]");
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-pull-close]");
  const progressRegion = dialog.querySelector<HTMLElement>("[data-pull-progress-region]");
  const progress = dialog.querySelector<HTMLProgressElement>("[data-pull-progress]");
  const status = dialog.querySelector<HTMLElement>("[data-pull-status]");
  const percent = dialog.querySelector<HTMLElement>("[data-pull-percent]");
  const detail = dialog.querySelector<HTMLElement>("[data-pull-detail]");
  const errorBox = dialog.querySelector<HTMLElement>("[data-pull-error]");
  const errorText = dialog.querySelector<HTMLElement>("[data-pull-error-message]");
  const success = dialog.querySelector<HTMLElement>("[data-pull-success]");
  if (!title || !command || !copyButton || !saveButton || !official || !cloudNote || !startButton || !closeButton || !progressRegion || !progress || !status || !percent || !detail || !errorBox || !errorText || !success) return;

  let selected: PullModel | null = null;
  let pullRunning = false;

  const resetState = (): void => {
    progressRegion.hidden = true;
    errorBox.hidden = true;
    success.hidden = true;
    progress.removeAttribute("value");
    percent.textContent = "";
    status.textContent = "Connecting to Ollama…";
    detail.textContent = "Keep Ollama open while the model downloads.";
    startButton.disabled = false;
    startButton.textContent = "Download with Ollama";
    closeButton.textContent = "Close";
  };

  const openForModel = (model: PullModel): void => {
    if (pullRunning && selected?.slug !== model.slug) {
      showToast(`${selected?.name ?? "A model"} is still downloading`, 2600);
    } else if (!pullRunning) {
      selected = model;
      resetState();
    }
    if (!selected) return;

    title.textContent = selected.name;
    command.textContent = selected.runCommand;
    copyButton.dataset.copyCommand = selected.runCommand;
    saveButton.dataset.saveModel = selected.slug.split(":", 1)[0] ?? selected.slug;
    saveButton.dataset.modelName = selected.name;
    saveButton.disabled = false;
    official.href = selected.officialUrl;
    cloudNote.hidden = !selected.cloud;
    updateSavedUi();
    if (!dialog.open) dialog.showModal();
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest<HTMLElement>("[data-open-pull]");
    if (!trigger || typeof dialog.showModal !== "function") return;
    const slug = validModelSlug(trigger.dataset.modelSlug);
    const name = trigger.dataset.modelName?.trim();
    const runCommand = trigger.dataset.runCommand?.trim();
    const officialUrl = trigger.dataset.officialUrl?.trim();
    if (!slug || !name || runCommand !== `ollama run ${slug}` || !officialUrl?.startsWith("https://ollama.com/")) return;
    event.preventDefault();
    openForModel({ slug, name, runCommand, officialUrl, cloud: trigger.dataset.modelCloud === "true" });
  });

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  startButton.addEventListener("click", async () => {
    if (!selected || pullRunning) return;
    pullRunning = true;
    startButton.disabled = true;
    startButton.textContent = "Downloading…";
    closeButton.textContent = "Hide";
    progressRegion.hidden = false;
    errorBox.hidden = true;
    success.hidden = true;
    progress.removeAttribute("value");
    percent.textContent = "";
    status.textContent = "Connecting to Ollama…";
    detail.textContent = "Your browser may ask for permission to reach the local Ollama service.";

    const configuredApi = document.documentElement.dataset.ollamaApi?.replace(/\/$/, "");
    const apiBase = configuredApi || DEFAULT_OLLAMA_API;

    try {
      const checkController = new AbortController();
      const checkTimer = window.setTimeout(() => checkController.abort(), 7000);
      let versionResponse: Response;
      try {
        versionResponse = await fetch(`${apiBase}/version`, {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          signal: checkController.signal
        });
      } finally {
        window.clearTimeout(checkTimer);
      }
      if (!versionResponse.ok) throw new Error(`Ollama connection check returned HTTP ${versionResponse.status}.`);
      const versionData = await versionResponse.json().catch(() => ({})) as { version?: string };
      status.textContent = "Connected to Ollama";
      detail.textContent = versionData.version
        ? `Ollama ${versionData.version} is ready. Starting the download…`
        : "Ollama is ready. Starting the download…";

      const response = await fetch(`${apiBase}/pull`, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selected.slug, stream: true })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Ollama returned HTTP ${response.status}.`);
      }
      if (!response.body) throw new Error("Ollama did not return download progress.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let confirmedSuccess = false;

      const handleLine = (line: string): void => {
        if (!line.trim()) return;
        let message: PullMessage;
        try {
          message = JSON.parse(line) as PullMessage;
        } catch {
          throw new Error("Ollama returned an unreadable progress update.");
        }
        if (message.error) throw new Error(message.error);
        const currentStatus = message.status ?? "Working";
        status.textContent = readableStatus(currentStatus);
        if (typeof message.total === "number" && message.total > 0 && typeof message.completed === "number") {
          const value = Math.min(100, Math.max(0, (message.completed / message.total) * 100));
          progress.value = value;
          percent.textContent = `${Math.round(value)}%`;
          detail.textContent = `${formatBytes(message.completed)} of ${formatBytes(message.total)} for the current file`;
        } else {
          progress.removeAttribute("value");
          percent.textContent = "";
          detail.textContent = currentStatus === "success"
            ? "The model is now available in Ollama on this computer."
            : "Keep Ollama open. Closing this panel may not stop a pull already accepted by Ollama.";
        }
        if (currentStatus === "success") confirmedSuccess = true;
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        if (buffer.length > 1_000_000) throw new Error("Ollama returned an unexpectedly large progress update.");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
        if (done) break;
      }
      if (buffer.trim()) handleLine(buffer);
      if (!confirmedSuccess) throw new Error("The download ended before Ollama confirmed success.");

      progress.value = 100;
      percent.textContent = "100%";
      status.textContent = "Download complete";
      detail.textContent = `${selected.name} is now available in Ollama on this computer.`;
      success.hidden = false;
      startButton.textContent = "Downloaded";
      showToast(`${selected.name} downloaded with Ollama`, 3200);
    } catch (error) {
      progressRegion.hidden = true;
      errorText.textContent = pullErrorMessage(error);
      errorBox.hidden = false;
      startButton.disabled = false;
      startButton.textContent = "Try download again";
    } finally {
      pullRunning = false;
      closeButton.textContent = "Close";
    }
  });
}

function setupCatalog(): void {
  const root = document.querySelector<HTMLElement>("[data-catalog]");
  if (!root) return;

  const search = root.querySelector<HTMLInputElement>("[data-catalog-search]");
  const sort = root.querySelector<HTMLSelectElement>("[data-catalog-sort]");
  const list = root.querySelector<HTMLElement>("[data-model-list]");
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-model-row]"));
  const capButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-capability]"));
  const resultCount = root.querySelector<HTMLElement>("[data-result-count]");
  const resultLabel = root.querySelector<HTMLElement>("[data-result-label]");
  const clear = root.querySelector<HTMLButtonElement>("[data-catalog-clear]");
  const empty = root.querySelector<HTMLElement>("[data-empty-state]");
  const emptyClear = root.querySelector<HTMLButtonElement>("[data-empty-clear]");
  if (!search || !sort || !list || !resultCount || !resultLabel || !clear || !empty) return;

  const parameters = new URLSearchParams(window.location.search);
  let query = parameters.get("q")?.trim().toLowerCase() ?? "";
  let capability = parameters.get("cap") ?? "all";
  let order = parameters.get("sort") ?? "newest";
  if (!capButtons.some((button) => button.dataset.capability === capability)) capability = "all";
  if (!new Set(["newest", "popular", "name"]).has(order)) order = "newest";
  search.value = query;
  sort.value = order;

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  const updateUrl = (): void => {
    const next = new URL(window.location.href);
    query ? next.searchParams.set("q", query) : next.searchParams.delete("q");
    capability !== "all" ? next.searchParams.set("cap", capability) : next.searchParams.delete("cap");
    order !== "newest" ? next.searchParams.set("sort", order) : next.searchParams.delete("sort");
    window.history.replaceState({}, "", next);
  };

  const apply = (): void => {
    const visible: HTMLElement[] = [];
    for (const row of rows) {
      const matchesQuery = !query || (row.dataset.search ?? "").includes(query);
      const matchesCapability = capability === "all" || (row.dataset.caps ?? "").split(" ").includes(capability);
      row.hidden = !(matchesQuery && matchesCapability);
      if (!row.hidden) visible.push(row);
    }

    const sorted = [...rows].sort((a, b) => {
      if (order === "popular") return Number(b.dataset.pulls) - Number(a.dataset.pulls);
      if (order === "name") return collator.compare(a.dataset.name ?? "", b.dataset.name ?? "");
      return Number(b.dataset.updated) - Number(a.dataset.updated) || collator.compare(a.dataset.name ?? "", b.dataset.name ?? "");
    });
    list.append(...sorted);

    for (const button of capButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.capability === capability));
    }
    resultCount.textContent = String(visible.length);
    resultLabel.textContent = visible.length === 1 ? "model" : "models";
    empty.hidden = visible.length !== 0;
    clear.hidden = !query && capability === "all" && order === "newest";
    updateUrl();
  };

  const reset = (): void => {
    query = "";
    capability = "all";
    order = "newest";
    search.value = "";
    sort.value = order;
    apply();
    search.focus();
  };

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    apply();
  });
  sort.addEventListener("change", () => {
    order = sort.value;
    apply();
  });
  for (const button of capButtons) {
    button.addEventListener("click", () => {
      capability = button.dataset.capability ?? "all";
      apply();
    });
  }
  clear.addEventListener("click", reset);
  emptyClear?.addEventListener("click", reset);
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== search && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === "Escape" && document.activeElement === search && search.value) reset();
  });

  apply();
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const copyButton = target.closest<HTMLButtonElement>("[data-copy-command]");
  if (copyButton) {
    const command = copyButton.dataset.copyCommand;
    if (!command) return;
    const original = copyButton.textContent ?? "Copy";
    const copied = await copyText(command);
    copyButton.textContent = copied ? "Copied" : "Select command";
    copyButton.classList.toggle("is-copied", copied);
    showToast(copied ? `Copied: ${command}` : "Clipboard access was unavailable");
    window.setTimeout(() => {
      copyButton.textContent = original;
      copyButton.classList.remove("is-copied");
    }, 1500);
    return;
  }

  const saveButton = target.closest<HTMLButtonElement>("[data-save-model]");
  if (!saveButton) return;
  const slug = validModelSlug(saveButton.dataset.saveModel);
  if (!slug) return;
  const name = saveButton.dataset.modelName || slug;
  saveButton.disabled = true;
  try {
    const wasSaved = await toggleSavedModel(slug, name);
    const signedIn = Boolean(getAccountState().user);
    showToast(wasSaved
      ? `${name} saved ${signedIn ? "to your profile" : "on this device — sign in to sync"}`
      : `${name} removed from My models`, signedIn ? 2200 : 3200);
  } catch (error) {
    showToast(errorMessage(error), 3800);
  } finally {
    saveButton.disabled = false;
    updateSavedUi();
  }
});

window.addEventListener(ACCOUNT_CHANGE_EVENT, updateSavedUi);

setupOriginHelp();
setupPullDialog();
setupCatalog();
setupSavedPage();
setupAccountUi();
setupProfilePage();
updateSavedUi();
void initializeAccount();
