const toast = document.querySelector<HTMLElement>("[data-toast]");
let toastTimer: number | undefined;

function showToast(message: string): void {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
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
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>("[data-copy-command]");
  if (!button) return;

  const command = button.dataset.copyCommand;
  if (!command) return;
  const original = button.textContent ?? "Copy";
  const copied = await copyText(command);
  button.textContent = copied ? "Copied" : "Select command";
  button.classList.toggle("is-copied", copied);
  showToast(copied ? `Copied: ${command}` : "Clipboard access was unavailable");
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove("is-copied");
  }, 1500);
});

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

setupCatalog();
