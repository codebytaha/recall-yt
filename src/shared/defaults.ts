import { DEFAULT_SETTINGS } from "./types.ts";
import type { Settings } from "./types.ts";

/** chrome.storage.local key. The service worker is the only reader of the api key. */
export const RECALL_SETTINGS_KEY = "recallSettings";

export const defaultSettings: Settings = DEFAULT_SETTINGS;
