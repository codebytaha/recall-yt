import { defaultSettings } from "./defaults.ts";
import type { ModelProfile, ProviderId, Settings } from "./types.ts";
import {
  MAX_INTERVAL_MINUTES,
  MAX_QUESTIONS_PER_STOP,
  MIN_INTERVAL_MINUTES,
  MIN_QUESTIONS_PER_STOP,
} from "./types.ts";

export function normalizeSettings(value: unknown): Settings {
  const raw = isRecord(value) ? value : {};
  const models = readModels(raw);
  const requested = typeof raw.activeModelId === "string" ? raw.activeModelId : "";
  const active = models.find((model) => model.id === requested) ?? models[0] ?? defaultSettings.models[0];
  if (!active) return { ...defaultSettings, models: defaultSettings.models.map((model) => ({ ...model })) };
  return {
    intervalMinutes: clamp(
      raw.intervalMinutes,
      MIN_INTERVAL_MINUTES,
      MAX_INTERVAL_MINUTES,
      defaultSettings.intervalMinutes,
    ),
    questionsPerStop: clamp(
      raw.questionsPerStop,
      MIN_QUESTIONS_PER_STOP,
      MAX_QUESTIONS_PER_STOP,
      defaultSettings.questionsPerStop,
    ),
    activeModelId: active.id,
    models,
    provider: active.provider,
    model: active.model,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    name: active.name,
  };
}

export function applyActive(settings: Settings, activeId: string): Settings {
  const active = settings.models.find((model) => model.id === activeId) ?? settings.models[0];
  if (!active) return settings;
  return {
    ...settings,
    activeModelId: active.id,
    provider: active.provider,
    model: active.model,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    name: active.name,
  };
}

export function displayName(profile: Pick<ModelProfile, "name" | "provider" | "baseUrl">): string {
  const named = profile.name.trim();
  if (named !== "") return named;
  if (profile.provider === "gemini") return "Gemini";
  if (profile.provider === "openai") return "OpenAI";
  try {
    const host = new URL(profile.baseUrl).host;
    return host === "" ? "OpenAI-compatible" : host;
  } catch {
    return "OpenAI-compatible";
  }
}

function readModels(raw: Record<string, unknown>): ModelProfile[] {
  if (Array.isArray(raw.models)) {
    const parsed = raw.models.map(readProfile).filter((profile): profile is ModelProfile => profile !== null);
    if (parsed.length > 0) return parsed;
  }
  return [profileFromFlat(raw)];
}

function profileFromFlat(raw: Record<string, unknown>): ModelProfile {
  const provider = isProvider(raw.provider) ? raw.provider : "openai";
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl : "";
  const model = typeof raw.model === "string" ? raw.model : "";
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  return {
    id: "default",
    name: displayName({ name, provider, baseUrl }),
    provider,
    model,
    baseUrl,
    apiKey,
  };
}

function readProfile(value: unknown): ModelProfile | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.trim() === "") return null;
  const provider = isProvider(value.provider) ? value.provider : "openai";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl : "";
  const name = typeof value.name === "string" ? value.name : "";
  return {
    id: value.id,
    name: displayName({ name, provider, baseUrl }),
    provider,
    model: typeof value.model === "string" ? value.model : "",
    baseUrl,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
  };
}

function isProvider(value: unknown): value is ProviderId {
  return value === "openai" || value === "gemini" || value === "openai-compatible";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
