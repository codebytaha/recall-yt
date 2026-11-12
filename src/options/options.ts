import { RECALL_SETTINGS_KEY, defaultSettings } from "../shared/defaults.ts";
import { applyActive, displayName, normalizeSettings } from "../shared/models.ts";
import {
  MAX_INTERVAL_MINUTES,
  MAX_QUESTIONS_PER_STOP,
  MIN_INTERVAL_MINUTES,
  MIN_QUESTIONS_PER_STOP,
} from "../shared/types.ts";
import type { ModelProfile, ProviderId, Settings } from "../shared/types.ts";

interface PageClassList {
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  toggle(token: string, force?: boolean): boolean;
}

interface PageNode {
  textContent: string | null;
  hidden: boolean;
  disabled: boolean;
  value: string;
  valueAsNumber: number;
  checked: boolean;
  classList: PageClassList;
  focus(): void;
  addEventListener(
    type: string,
    listener: (event: { preventDefault(): void }) => void,
  ): void;
}

interface PageDocument {
  getElementById(id: string): PageNode | null;
}

interface ParsedUrl {
  protocol: string;
  hostname: string;
  port: string;
  origin: string;
}

declare const URL: new (url: string) => ParsedUrl;

const page = (globalThis as unknown as { document: PageDocument }).document;

const PROVIDERS: readonly ProviderId[] = [
  "openai",
  "gemini",
  "openai-compatible",
];

interface ChromeLike {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  permissions: {
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
  runtime: {
    sendMessage(message: { type: "TEST_KEY" }): Promise<unknown>;
  };
}

const chrome = (globalThis as unknown as { chrome: ChromeLike }).chrome;

const form = requiredElement("settings-form");
const intervalInput = requiredElement("interval");
const questionsInput = requiredElement("questions");
const providerInput = requiredElement("provider");
const modelInput = requiredElement("model");
const baseUrlField = requiredElement("base-url-field");
const baseUrlInput = requiredElement("base-url");
const apiKeyInput = requiredElement("api-key");
const saveButton = requiredElement("save");
const testButton = requiredElement("test-key");
const notice = requiredElement("notice");
const dom = (globalThis as unknown as { document: Document }).document;
const savedSelect = dom.getElementById("saved-model") as HTMLSelectElement;
const nameInput = dom.getElementById("model-name") as HTMLInputElement;
const nameLabel = dom.getElementById("model-name-label");
const addModelButton = dom.getElementById("add-model") as HTMLButtonElement;
const removeModelButton = dom.getElementById("remove-model") as HTMLButtonElement;

let draft: Settings = {
  ...defaultSettings,
  models: defaultSettings.models.map((model) => ({ ...model })),
};
let editingId = draft.activeModelId;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

providerInput.addEventListener("change", () => {
  syncBaseUrlField();
});

savedSelect.addEventListener("change", () => {
  draft = storeForm(draft, editingId);
  editingId = savedSelect.value;
  paintSavedModels();
  fillProfile(profileById(draft, editingId));
});

nameInput.addEventListener("input", () => {
  const option = savedSelect.selectedOptions[0];
  if (!option) return;
  const typed = nameInput.value.trim();
  option.textContent = typed === "" ? "Untitled model" : typed;
});

addModelButton.addEventListener("click", () => {
  draft = storeForm(draft, editingId);
  const profile: ModelProfile = {
    id: `model-${Date.now()}`,
    name: "",
    provider: "openai-compatible",
    model: "",
    baseUrl: "",
    apiKey: "",
  };
  draft = { ...draft, models: [...draft.models, profile] };
  editingId = profile.id;
  paintSavedModels();
  fillProfile(profile);
  nameInput.focus();
});

removeModelButton.addEventListener("click", () => {
  if (draft.models.length <= 1) {
    showNotice("Keep at least one model.", "miss");
    return;
  }
  const models = draft.models.filter((model) => model.id !== editingId);
  const next = models[0];
  if (!next) return;
  editingId = next.id;
  draft = applyActive({ ...draft, models }, editingId);
  paintSavedModels();
  fillProfile(next);
});

testButton.addEventListener("click", () => {
  void testKey();
});

setBusy(true);
void loadSettings();

async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([RECALL_SETTINGS_KEY]);
    draft = normalizeSettings(stored[RECALL_SETTINGS_KEY]);
    editingId = draft.activeModelId;
    fillForm(draft);
  } catch (err) {
    showNotice(errorText(err, "Could not load settings."), "miss");
  } finally {
    setBusy(false);
  }
}

async function saveSettings(): Promise<void> {
  const provider = isProvider(providerInput.value) ? providerInput.value : "openai";
  if (provider === "openai-compatible" && nameInput.value.trim() === "") {
    showNotice("Name this provider so Recall can say which one it is calling.", "miss");
    nameInput.focus();
    return;
  }
  draft = applyActive(
    storeForm(
      {
        ...draft,
        intervalMinutes: readCount(
          intervalInput,
          MIN_INTERVAL_MINUTES,
          MAX_INTERVAL_MINUTES,
          defaultSettings.intervalMinutes,
        ),
        questionsPerStop: readCount(
          questionsInput,
          MIN_QUESTIONS_PER_STOP,
          MAX_QUESTIONS_PER_STOP,
          defaultSettings.questionsPerStop,
        ),
      },
      editingId,
    ),
    editingId,
  );
  const pattern = hostPermissionPattern(draft);
  if (draft.provider === "openai-compatible" && draft.baseUrl !== "" && pattern === null) {
    showNotice("Enter a full http or https address.", "miss");
    baseUrlInput.focus();
    return;
  }

  const permissionRequest =
    pattern === null ? null : chrome.permissions.request({ origins: [pattern] });
  setBusy(true);
  try {
    let denied = false;
    if (permissionRequest !== null) {
      try {
        denied = (await permissionRequest) !== true;
      } catch (err) {
        await chrome.storage.local.set({ [RECALL_SETTINGS_KEY]: draft });
        showNotice(errorText(err, "Could not ask for that address."), "miss");
        return;
      }
    }
    await chrome.storage.local.set({ [RECALL_SETTINGS_KEY]: draft });
    fillForm(draft);
    if (denied) {
      showNotice(
        "Permission denied. Settings are saved, and Recall cannot call that address.",
        "miss",
      );
      return;
    }
    const active = profileById(draft, draft.activeModelId);
    showNotice(`Saved. Recall will call ${displayName(active)}.`, "ok");
  } catch (err) {
    showNotice(errorText(err, "Could not save."), "miss");
  } finally {
    setBusy(false);
  }
}

async function testKey(): Promise<void> {
  setBusy(true);
  showNotice("Checking the saved key.", "plain");
  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_KEY" });
    const described = describeTest(result);
    showNotice(described.text, described.tone);
  } catch (err) {
    showNotice(errorText(err, "Key test failed."), "miss");
  } finally {
    setBusy(false);
  }
}

function storeForm(settings: Settings, id: string): Settings {
  const profile = readProfileFromForm(id);
  const models = settings.models.some((model) => model.id === id)
    ? settings.models.map((model) => (model.id === id ? profile : model))
    : [...settings.models, profile];
  return { ...settings, models };
}

function readProfileFromForm(id: string): ModelProfile {
  const provider = isProvider(providerInput.value) ? providerInput.value : "openai";
  const baseUrl = provider === "openai-compatible" ? baseUrlInput.value.trim() : "";
  return {
    id,
    name: nameInput.value.trim(),
    provider,
    model: modelInput.value.trim(),
    baseUrl,
    apiKey: apiKeyInput.value.trim(),
  };
}

function profileById(settings: Settings, id: string): ModelProfile {
  return settings.models.find((model) => model.id === id) ?? settings.models[0] ?? defaultSettings.models[0];
}

function fillForm(settings: Settings): void {
  intervalInput.value = String(settings.intervalMinutes);
  questionsInput.value = String(settings.questionsPerStop);
  editingId = settings.activeModelId;
  paintSavedModels();
  fillProfile(profileById(settings, settings.activeModelId));
}

function fillProfile(profile: ModelProfile): void {
  nameInput.value = profile.name;
  providerInput.value = profile.provider;
  modelInput.value = profile.model;
  baseUrlInput.value = profile.baseUrl;
  apiKeyInput.value = profile.apiKey;
  syncBaseUrlField();
}

function paintSavedModels(): void {
  const selected = editingId;
  savedSelect.replaceChildren();
  for (const model of draft.models) {
    const option = dom.createElement("option");
    option.value = model.id;
    option.textContent = model.name.trim() === "" ? "Untitled model" : model.name;
    savedSelect.append(option);
  }
  if (draft.models.some((model) => model.id === selected)) savedSelect.value = selected;
}

function syncBaseUrlField(): void {
  const compatible = providerInput.value === "openai-compatible";
  baseUrlField.hidden = !compatible;
  if (nameLabel) nameLabel.textContent = compatible ? "Provider name" : "Name";
}

/**
 * Match pattern for one compatible host: its origin and every path.
 * A port is omitted because match patterns cannot name one; the grant
 * covers every port on that host. Wildcard hosts are refused.
 */
function hostPermissionPattern(settings: Settings): string | null {
  if (settings.provider !== "openai-compatible" || settings.baseUrl === "") {
    return null;
  }
  let url: ParsedUrl;
  try {
    url = new URL(settings.baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname === "" || url.hostname.includes("*")) return null;
  const host = matchHost(url.hostname);
  if (host === "*") return null;
  const root = url.port === "" ? url.origin : `${url.protocol}//${host}`;
  return root + "/" + "*";
}

/** Bracket an IPv6 host once, whether or not the parser already did. */
function matchHost(hostname: string): string {
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (bare.includes(":")) return `[${bare}]`;
  return bare;
}

const TEST_ERRORS: Record<string, string> = {
  "missing-key": "Add an API key and save it first.",
  "missing-model": "Add a model and save it first.",
  "missing-base-url": "Add a base URL and save it first.",
  "bad-base-url": "That base URL is not a full http or https address.",
  unauthorized: "The key was rejected.",
  "request-failed": "The provider could not be reached.",
  "bad-request": "Key test failed.",
  "invalid-quiz": "Key test failed.",
};

function describeTest(result: unknown): { text: string; tone: NoticeTone } {
  if (result !== null && typeof result === "object") {
    const body = result as { ok?: unknown; error?: unknown; reason?: unknown };
    if (body.ok === true) return { text: "Key works.", tone: "ok" };
    const detail = explainTestError(body.error) ?? explainTestError(body.reason);
    if (detail !== null) return { text: detail, tone: "miss" };
  }
  return { text: "Key test failed.", tone: "miss" };
}

function explainTestError(value: unknown): string | null {
  const text = clipText(value);
  if (text === null) return null;
  return TEST_ERRORS[text] ?? text;
}

function clipText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, 500);
}

type NoticeTone = "ok" | "miss" | "plain";

function showNotice(text: string, tone: NoticeTone): void {
  notice.textContent = text;
  notice.classList.toggle("ok", tone === "ok");
  notice.classList.toggle("miss", tone === "miss");
}

function setBusy(busy: boolean): void {
  saveButton.disabled = busy;
  testButton.disabled = busy;
  intervalInput.disabled = busy;
  questionsInput.disabled = busy;
  providerInput.disabled = busy;
  modelInput.disabled = busy;
  baseUrlInput.disabled = busy;
  apiKeyInput.disabled = busy;
  savedSelect.disabled = busy;
  nameInput.disabled = busy;
  addModelButton.disabled = busy;
  removeModelButton.disabled = busy;
}

function readCount(input: PageNode, min: number, max: number, fallback: number): number {
  return clampUnknown(input.valueAsNumber, min, max, fallback);
}

function clampUnknown(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim() !== "") return err.message.trim();
  return fallback;
}

function requiredElement(id: string): PageNode {
  const node = page.getElementById(id);
  if (node === null) throw new Error(`Missing #${id}`);
  return node;
}
