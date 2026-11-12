import type { Settings } from "../shared/types.ts";

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";

export type ProviderConfigCode =
  | "missing-key"
  | "missing-model"
  | "missing-base-url"
  | "bad-base-url";

export class ProviderConfigError extends Error {
  readonly code: ProviderConfigCode;

  constructor(code: ProviderConfigCode) {
    super(code);
    this.name = "ProviderConfigError";
    this.code = code;
  }
}

/** Wire request. `body` is JSON text for POST and empty for a key check GET. */
export interface ProviderHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Quiz call for the saved provider.
 * The user message is the `buildQuizPrompt` string, unchanged.
 * The API key is placed only in a header.
 */
export function buildProviderRequest(settings: Settings, userMessage: string): ProviderHttpRequest {
  const apiKey = requireKey(settings.apiKey);
  if (settings.provider === "gemini") {
    return seal(
      {
        method: "POST",
        url: geminiGenerateUrl(requireModel(settings.model, apiKey)),
        headers: geminiHeaders(apiKey),
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: userMessage }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      },
      apiKey,
    );
  }
  return seal(
    {
      method: "POST",
      url: chatCompletionsUrl(settings),
      headers: openAiHeaders(apiKey),
      body: JSON.stringify({
        model: requireModel(settings.model, apiKey),
        messages: [{ role: "user", content: userMessage }],
        response_format: { type: "json_object" },
      }),
    },
    apiKey,
  );
}

/**
 * Tiny saved-key check. Reads nothing from the caller except `settings`.
 * OpenAI and compatible hosts: GET `{base}/models`. Gemini: GET the model list.
 * The key stays in a header.
 */
export function buildTestKeyRequest(settings: Settings): ProviderHttpRequest {
  const apiKey = requireKey(settings.apiKey);
  if (settings.provider === "gemini") {
    return seal(
      {
        method: "GET",
        url: geminiModelsUrl(),
        headers: { "x-goog-api-key": apiKey },
        body: "",
      },
      apiKey,
    );
  }
  return seal(
    {
      method: "GET",
      url: modelsUrl(settings),
      headers: { Authorization: `Bearer ${apiKey}` },
      body: "",
    },
    apiKey,
  );
}

/**
 * Assistant text from a chat-completions JSON body or a generateContent JSON body.
 * Returns null when that text is absent. Never reads an API key field.
 */
export function extractModelText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (Array.isArray(payload.choices)) return openAiText(payload);
  if (Array.isArray(payload.candidates)) return geminiText(payload);
  return null;
}

/**
 * Questions array from model text. Accepts a bare array or one JSON object
 * whose array is `questions` (json_object responses are objects).
 */
export function parseModelQuestions(text: string): unknown {
  return unwrapQuestions(JSON.parse(isolateJson(text)));
}

function chatCompletionsUrl(settings: Settings): string {
  return joinApi(apiBase(settings), "chat/completions", settings.apiKey);
}

function modelsUrl(settings: Settings): string {
  return joinApi(apiBase(settings), "models", settings.apiKey);
}

function apiBase(settings: Settings): string {
  if (settings.provider === "openai") return OPENAI_DEFAULT_BASE;
  const base = settings.baseUrl.trim();
  if (base === "") throw new ProviderConfigError("missing-base-url");
  return base;
}

function geminiGenerateUrl(model: string): string {
  const url = new URL(
    `${GEMINI_ORIGIN}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  );
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

function geminiModelsUrl(): string {
  return `${GEMINI_ORIGIN}/v1beta/models`;
}

function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function geminiHeaders(apiKey: string): Record<string, string> {
  return {
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

function requireKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key === "") throw new ProviderConfigError("missing-key");
  return key;
}

function requireModel(model: string, apiKey: string): string {
  const id = model.trim().replace(/^models\//u, "").replace(/:generateContent$/u, "");
  if (id === "" || (apiKey.length >= 8 && id.includes(apiKey))) {
    throw new ProviderConfigError("missing-model");
  }
  return id;
}

function joinApi(base: string, leaf: "chat/completions" | "models", apiKey: string): string {
  const url = parseHttpBase(base, apiKey);
  let path = url.pathname.replace(/\/+$/u, "");
  for (const suffix of ["/chat/completions", "/models"]) {
    if (path.endsWith(suffix)) path = path.slice(0, -suffix.length);
  }
  path = path.replace(/\/+$/u, "");
  url.pathname = `${path}/${leaf}`.replace(/\/{2,}/gu, "/");
  return url.toString();
}

function parseHttpBase(base: string, apiKey: string): URL {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new ProviderConfigError("bad-base-url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProviderConfigError("bad-base-url");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  const secret = apiKey.trim();
  if (secret.length >= 8) {
    const bearer = `Bearer ${secret}`;
    for (const [name, value] of [...url.searchParams.entries()]) {
      if (value.includes(secret) || value.includes(bearer)) url.searchParams.delete(name);
    }
  }
  return url;
}

function seal(request: ProviderHttpRequest, apiKey: string): ProviderHttpRequest {
  const url = new URL(request.url);
  const secret = apiKey.trim();
  if (secret.length >= 8) {
    const encoded = encodeURIComponent(secret);
    const haystack = `${url.username}${url.password}${url.pathname}${url.search}${url.hash}`;
    if (haystack.includes(secret) || (encoded !== secret && haystack.includes(encoded))) {
      throw new ProviderConfigError("bad-base-url");
    }
  }
  for (const name of Object.keys(request.headers)) {
    if (url.searchParams.has(name) || url.searchParams.has(name.toLowerCase())) {
      throw new ProviderConfigError("bad-base-url");
    }
  }
  return request;
}

function openAiText(payload: Record<string, unknown>): string | null {
  const choice = payload.choices;
  if (!Array.isArray(choice) || choice.length === 0) return null;
  const first = choice[0];
  if (!isRecord(first)) return null;
  const message = first.message;
  if (isRecord(message)) return textFromContent(message.content);
  return textFromContent(first.text);
}

function geminiText(payload: Record<string, unknown>): string | null {
  const candidates = payload.candidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) continue;
    const text = textFromContent(candidate.content.parts);
    if (text != null && text.trim() !== "") return text;
  }
  return null;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (!isRecord(part) || typeof part.text !== "string") continue;
    if (part.type === "reasoning" || part.thought === true) continue;
    parts.push(part.text);
  }
  if (parts.length === 0) return null;
  return parts.join("");
}

function isolateJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const source = (fenced?.[1] ?? trimmed).trim();
  const start = firstJsonIndex(source);
  if (start === 0) return source;
  if (start < 0) throw new SyntaxError("invalid-quiz");
  const end = Math.max(source.lastIndexOf("}"), source.lastIndexOf("]"));
  if (end < start) throw new SyntaxError("invalid-quiz");
  return source.slice(start, end + 1);
}

function firstJsonIndex(source: string): number {
  const objectAt = source.indexOf("{");
  const arrayAt = source.indexOf("[");
  if (objectAt < 0) return arrayAt;
  if (arrayAt < 0) return objectAt;
  return Math.min(objectAt, arrayAt);
}

function unwrapQuestions(value: unknown, depth = 0): unknown {
  if (depth > 3) return value;
  if (typeof value === "string") {
    return unwrapQuestions(JSON.parse(isolateJson(value)), depth + 1);
  }
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return value;
  if (Array.isArray(value.questions)) return value.questions;
  const quiz = value.quiz;
  if (Array.isArray(quiz)) return quiz;
  if (isRecord(quiz) && Array.isArray(quiz.questions)) return quiz.questions;
  const arrays = Object.values(value).filter(Array.isArray);
  if (arrays.length === 1) return arrays[0];
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
