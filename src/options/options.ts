import { RECALL_SETTINGS_KEY, defaultSettings } from "../shared/defaults.ts";
import {
  MAX_INTERVAL_MINUTES,
  MAX_QUESTIONS_PER_STOP,
  MIN_INTERVAL_MINUTES,
  MIN_QUESTIONS_PER_STOP,
} from "../shared/types.ts";
import type { ProviderId, Settings } from "../shared/types.ts";

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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

providerInput.addEventListener("change", () => {
  syncBaseUrlField();
});

testButton.addEventListener("click", () => {
  void testKey();
});

setBusy(true);
void loadSettings();

async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([RECALL_SETTINGS_KEY]);
    fillForm(normalizeSettings(stored[RECALL_SETTINGS_KEY]));
  } catch (err) {
    showNotice(errorText(err, "Could not load settings."), "miss");
  } finally {
    setBusy(false);
  }
}

async function saveSettings(): Promise<void> {
  const settings = readForm();
  const pattern = hostPermissionPattern(settings);
  if (
    settings.provider === "openai-compatible" &&
    settings.baseUrl !== "" &&
    pattern === null
  ) {
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
        await chrome.storage.local.set({ [RECALL_SETTINGS_KEY]: settings });
        showNotice(errorText(err, "Could not ask for that address."), "miss");
        return;
      }
    }
    await chrome.storage.local.set({ [RECALL_SETTINGS_KEY]: settings });
    fillForm(settings);
    if (denied) {
      showNotice(
        "Permission denied. Settings are saved, and Recall cannot call that address.",
        "miss",
      );
      return;
    }
    showNotice("Saved.", "ok");
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

function readForm(): Settings {
  return {
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
    provider: isProvider(providerInput.value)
      ? providerInput.value
      : defaultSettings.provider,
    model: modelInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
  };
}

function fillForm(settings: Settings): void {
  intervalInput.value = String(settings.intervalMinutes);
  questionsInput.value = String(settings.questionsPerStop);
  providerInput.value = settings.provider;
  modelInput.value = settings.model;
  baseUrlInput.value = settings.baseUrl;
  apiKeyInput.value = settings.apiKey;
  syncBaseUrlField();
}

function syncBaseUrlField(): void {
  baseUrlField.hidden = providerInput.value !== "openai-compatible";
}

function normalizeSettings(value: unknown): Settings {
  const fallback = defaultSettings;
  if (value === null || typeof value !== "object") {
    return { ...fallback };
  }
  const raw = value as Record<string, unknown>;
  return {
    intervalMinutes: clampUnknown(
      raw.intervalMinutes,
      MIN_INTERVAL_MINUTES,
      MAX_INTERVAL_MINUTES,
      fallback.intervalMinutes,
    ),
    questionsPerStop: clampUnknown(
      raw.questionsPerStop,
      MIN_QUESTIONS_PER_STOP,
      MAX_QUESTIONS_PER_STOP,
      fallback.questionsPerStop,
    ),
    provider: isProvider(raw.provider) ? raw.provider : fallback.provider,
    model: typeof raw.model === "string" ? raw.model : fallback.model,
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : fallback.baseUrl,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : fallback.apiKey,
  };
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
