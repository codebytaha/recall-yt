/// <reference path="./chrome.d.ts" />

import {
  ProviderConfigError,
  buildTestKeyRequest,
} from "./providers.ts";
import type { ProviderConfigCode, ProviderHttpRequest } from "./providers.ts";
import { RECALL_SETTINGS_KEY, defaultSettings } from "../shared/defaults.ts";
import { MAX_QUESTIONS_PER_STOP, MIN_QUESTIONS_PER_STOP } from "../shared/types.ts";
import type { Cue, Quiz, Settings } from "../shared/types.ts";
import { MODEL_REQUEST_MS } from "../shared/windows.ts";
import { runQuizGeneration } from "./quiz-run.ts";
import type { PhaseNotice } from "./quiz-run.ts";

export type { ProviderConfigCode };

export type WorkerErrorCode =
  | ProviderConfigCode
  | "bad-request"
  | "invalid-quiz"
  | "request-failed"
  | "unauthorized"
  | "timed-out";

export interface GenerateQuizMessage {
  type: "GENERATE_QUIZ";
  videoId: string;
  startMs: number;
  endMs: number;
  cues: Cue[];
  questionsPerStop: number;
}

export interface TestKeyMessage {
  type: "TEST_KEY";
}

export type WorkerRequest = GenerateQuizMessage | TestKeyMessage;

export type WorkerFailure = { ok: false; error: WorkerErrorCode };

export type GenerateQuizResponse = { ok: true; quiz: Quiz } | WorkerFailure;

export type TestKeyResponse = { ok: true } | WorkerFailure;

export type WorkerResponse = GenerateQuizResponse | TestKeyResponse;

class HttpFailure extends Error {
  readonly code: "request-failed" | "unauthorized" | "timed-out";

  constructor(code: "request-failed" | "unauthorized" | "timed-out") {
    super(code);
    this.name = "HttpFailure";
    this.code = code;
  }
}

/**
 * MV3 service worker. No alarms and no timers.
 * Quiz generation reports phases on the recall-quiz port, then one result.
 * The api key is read from chrome.storage.local and is never copied onto a message.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "recall-quiz") return;
  port.onMessage.addListener((message) => {
    void generateQuiz(message, (notice) => {
      port.postMessage({ type: "progress", phase: notice.phase, label: notice.label });
    }).then(
      (response) => {
        port.postMessage({ type: "result", ...response });
      },
      () => {
        port.postMessage({ type: "result", ok: false, error: "request-failed" });
      },
    );
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (messageType(message) == null) return false;
  void handleWorkerMessage(message).then(
    (response) => {
      sendResponse(response ?? { ok: false, error: "bad-request" });
    },
    () => {
      sendResponse({ ok: false, error: "request-failed" });
    },
  );
  return true;
});

export async function handleWorkerMessage(message: unknown): Promise<WorkerResponse | undefined> {
  const type = messageType(message);
  if (type === "GENERATE_QUIZ") return generateQuiz(message);
  if (type === "TEST_KEY") return testSavedKey();
  return undefined;
}

async function generateQuiz(
  message: unknown,
  onPhase?: (notice: PhaseNotice) => void,
): Promise<GenerateQuizResponse> {
  const parsed = readGenerateMessage(message);
  if (parsed == null) return { ok: false, error: "bad-request" };
  const settings = await readSettings();
  return runQuizGeneration({
    settings,
    job: parsed,
    call: callProvider,
    onPhase,
  });
}

async function testSavedKey(): Promise<TestKeyResponse> {
  const settings = await readSettings();
  let request: ProviderHttpRequest;
  try {
    request = buildTestKeyRequest(settings);
  } catch (error) {
    return { ok: false, error: configCode(error) };
  }
  try {
    const payload = await callProvider(request);
    if (isRecord(payload) && payload.error != null) return { ok: false, error: "request-failed" };
    return { ok: true };
  } catch (error) {
    if (error instanceof HttpFailure) return { ok: false, error: error.code };
    return { ok: false, error: "request-failed" };
  }
}

async function callProvider(request: ProviderHttpRequest): Promise<unknown> {
  const stopKeepAlive = keepWorkerAlive();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_REQUEST_MS);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === "POST" ? request.body : undefined,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new HttpFailure("timed-out");
    throw new HttpFailure("request-failed");
  } finally {
    clearTimeout(timer);
    stopKeepAlive();
  }
  if (!response.ok) {
    await discardBody(response);
    const code = response.status === 401 || response.status === 403 ? "unauthorized" : "request-failed";
    throw new HttpFailure(code);
  }
  try {
    return await response.json();
  } catch {
    throw new SyntaxError("invalid-quiz");
  }
}

function keepWorkerAlive(): () => void {
  const timer = setInterval(() => {
    const ask = chrome.runtime.getPlatformInfo;
    if (typeof ask === "function") void ask();
  }, 10_000);
  return () => clearInterval(timer);
}

async function discardBody(response: { text(): Promise<string> }): Promise<void> {
  try {
    await response.text();
  } catch {
    // The status code is enough. Body text is not returned to the content script.
  }
}

async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(RECALL_SETTINGS_KEY);
  return normalizeSettings(stored[RECALL_SETTINGS_KEY]);
}

function normalizeSettings(value: unknown): Settings {
  const settings: Settings = { ...defaultSettings };
  if (!isRecord(value)) return settings;
  if (
    value.provider === "openai" ||
    value.provider === "gemini" ||
    value.provider === "openai-compatible"
  ) {
    settings.provider = value.provider;
  }
  if (typeof value.model === "string") settings.model = value.model;
  if (typeof value.baseUrl === "string") settings.baseUrl = value.baseUrl;
  if (typeof value.apiKey === "string") settings.apiKey = value.apiKey;
  if (typeof value.intervalMinutes === "number" && Number.isFinite(value.intervalMinutes)) {
    settings.intervalMinutes = value.intervalMinutes;
  }
  if (typeof value.questionsPerStop === "number" && Number.isFinite(value.questionsPerStop)) {
    settings.questionsPerStop = value.questionsPerStop;
  }
  return settings;
}

function readGenerateMessage(message: unknown): GenerateQuizMessage | null {
  if (!isRecord(message) || message.type !== "GENERATE_QUIZ") return null;
  const videoId = message.videoId;
  const startMs = message.startMs;
  const endMs = message.endMs;
  const questionsPerStop = message.questionsPerStop;
  const cues = readCues(message.cues);
  if (typeof videoId !== "string" || videoId.trim() === "") return null;
  if (typeof startMs !== "number" || typeof endMs !== "number") return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return null;
  if (typeof questionsPerStop !== "number" || !Number.isInteger(questionsPerStop)) return null;
  if (questionsPerStop < MIN_QUESTIONS_PER_STOP || questionsPerStop > MAX_QUESTIONS_PER_STOP) {
    return null;
  }
  if (cues == null) return null;
  return {
    type: "GENERATE_QUIZ",
    videoId: videoId.trim(),
    startMs,
    endMs,
    cues,
    questionsPerStop,
  };
}

function readCues(value: unknown): Cue[] | null {
  if (!Array.isArray(value)) return null;
  const cues: Cue[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const startMs = item.startMs;
    const endMs = item.endMs;
    const text = item.text;
    if (typeof startMs !== "number" || typeof endMs !== "number" || typeof text !== "string") return null;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

function messageType(message: unknown): "GENERATE_QUIZ" | "TEST_KEY" | null {
  if (!isRecord(message)) return null;
  if (message.type === "GENERATE_QUIZ" || message.type === "TEST_KEY") return message.type;
  return null;
}

function configCode(error: unknown): WorkerErrorCode {
  if (error instanceof ProviderConfigError) return error.code;
  return "request-failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
