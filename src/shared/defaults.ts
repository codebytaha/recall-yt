import {
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_QUESTIONS_PER_STOP,
} from "./types.ts";
import type { Settings } from "./types.ts";

/** chrome.storage.local key. The service worker is the only reader of the api key. */
export const RECALL_SETTINGS_KEY = "recallSettings";

export const defaultSettings: Settings = {
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  questionsPerStop: DEFAULT_QUESTIONS_PER_STOP,
  provider: "openai",
  model: "",
  baseUrl: "",
  apiKey: "",
};
