const toast = document.querySelector<HTMLElement>("[data-toast]");
const SAVED_MODELS_KEY = "ailocalclick:saved-models:v1";
const SAVED_CHANGE_EVENT = "ailocalclick:saved-change";
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

function readSavedModels(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_MODELS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.flatMap((value) => typeof value === "string" && validModelSlug(value) ? [value] : []));
  } catch {
    return new Set();
  }
}

function writeSavedModels(saved: Set<string>): boolean {
  try {
    localStorage.setItem(SAVED_MODELS_KEY, JSON.stringify([...saved].sort()));
    window.dispatchEvent(new CustomEvent(SAVED_CHANGE_EVENT));
    return true;
  } catch {
    showToast("This browser could not save the list", 2600);
    return false;
  }
}

function updateSavedUi(): void {
  const saved = readSavedModels();
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
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-model-row]"));
  const count = root.querySelector<HTMLElement>("[data-saved-page-count]");
  const label = root.querySelector<HTMLElement>("[data-saved-page-label]");
  const loading = root.querySelector<HTMLElement>("[data-saved-loading]");
  const empty = root.querySelector<HTMLElement>("[data-saved-empty]");
  const emptyMessage = root.querySelector<HTMLElement>("[data-saved-empty-message]");
  const exportButton = root.querySelector<HTMLButtonElement>("[data-export-saved]");
  const clearButton = root.querySelector<HTMLButtonElement>("[data-clear-saved]");
  if (!search || !count || !label || !loading || !empty || !emptyMessage || !exportButton || !clearButton) return;

  const apply = (): void => {
    const saved = readSavedModels();
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const slug = validModelSlug(row.dataset.modelSlug);
      const isSaved = Boolean(slug && saved.has(slug));
      const matches = !query || (row.dataset.search ?? "").includes(query);
      row.hidden = !(isSaved && matches);
      if (!row.hidden) visible += 1;
    }

    count.textContent = String(visible);
    label.textContent = visible === 1 ? "model" : "models";
    loading.hidden = true;
    empty.hidden = visible > 0;
    emptyMessage.textContent = saved.size === 0
      ? "Your saved list is empty."
      : "No saved models match that search.";
    exportButton.disabled = saved.size === 0;
    clearButton.disabled = saved.size === 0;
  };

  search.addEventListener("input", apply);
  exportButton.addEventListener("click", () => {
    const saved = readSavedModels();
    const exportedModels = rows.flatMap((row) => {
      const slug = validModelSlug(row.dataset.modelSlug);
      if (!slug || !saved.has(slug)) return [];
      return [{
        slug,
        name: row.dataset.modelName ?? slug,
        command: row.dataset.modelCommand ?? `ollama run ${slug}`,
        officialUrl: row.dataset.modelUrl ?? `https://ollama.com/library/${slug}`
      }];
    });
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      source: "ailocal.click",
      models: exportedModels
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ailocalclick-saved-models-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${exportedModels.length} saved ${exportedModels.length === 1 ? "model" : "models"}`);
  });
  clearButton.addEventListener("click", () => {
    if (!window.confirm("Remove every model from this browser's saved list?")) return;
    if (writeSavedModels(new Set())) showToast("Saved list cleared");
  });
  window.addEventListener(SAVED_CHANGE_EVENT, apply);
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_MODELS_KEY) apply();
  });
  apply();
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
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Ollama did not respond in time. Make sure it is open, then try again.";
  }
  if (error instanceof TypeError) {
    return "The browser could not reach local Ollama. Make sure Ollama is open, allow local-network access if asked, and use the connection guide if this site is blocked.";
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
    saveButton.dataset.saveModel = selected.slug;
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
      errorText.textContent = errorMessage(error);
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
  const saved = readSavedModels();
  const willSave = !saved.has(slug);
  willSave ? saved.add(slug) : saved.delete(slug);
  if (!writeSavedModels(saved)) return;
  updateSavedUi();
  const name = saveButton.dataset.modelName || slug;
  showToast(willSave ? `${name} saved to My models` : `${name} removed from My models`);
});

window.addEventListener(SAVED_CHANGE_EVENT, updateSavedUi);
window.addEventListener("storage", (event) => {
  if (event.key === SAVED_MODELS_KEY) updateSavedUi();
});

setupOriginHelp();
setupPullDialog();
setupCatalog();
setupSavedPage();
updateSavedUi();
