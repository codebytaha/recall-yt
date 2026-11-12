import {
  ProviderConfigError,
  buildProviderRequest,
  extractModelText,
  parseModelQuestions,
} from "./providers.ts";
import type { ProviderConfigCode, ProviderHttpRequest } from "./providers.ts";
import { providerLabel } from "../shared/progress.ts";
import { buildQuizPrompt } from "../shared/prompt.ts";
import type { Cue, Quiz, Settings } from "../shared/types.ts";
import { validateQuiz } from "../shared/validate-quiz.ts";

export type QuizRunError =
  | ProviderConfigCode
  | "invalid-quiz"
  | "request-failed"
  | "unauthorized"
  | "timed-out";

export type QuizRunResult = { ok: true; quiz: Quiz } | { ok: false; error: QuizRunError };

export type QuizPhase = "calling" | "writing" | "checking" | "retrying";

export interface PhaseNotice {
  phase: QuizPhase;
  label: string;
}

export interface QuizJob {
  videoId: string;
  startMs: number;
  endMs: number;
  cues: Cue[];
  questionsPerStop: number;
}

const ATTEMPTS = 2;

export async function runQuizGeneration(options: {
  settings: Settings;
  job: QuizJob;
  call: (request: ProviderHttpRequest) => Promise<unknown>;
  onPhase?: (notice: PhaseNotice) => void;
}): Promise<QuizRunResult> {
  let request: ProviderHttpRequest;
  try {
    request = buildProviderRequest(
      options.settings,
      buildQuizPrompt({
        cues: options.job.cues,
        startMs: options.job.startMs,
        endMs: options.job.endMs,
        questionCount: options.job.questionsPerStop,
      }),
    );
  } catch (error) {
    return { ok: false, error: configCode(error) };
  }

  const label = providerLabel(options.settings);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    options.onPhase?.({ phase: attempt === 0 ? "calling" : "retrying", label });
    let payload: unknown;
    try {
      payload = await options.call(request);
    } catch (error) {
      const code = httpCode(error);
      if (code) return { ok: false, error: code };
      if (error instanceof SyntaxError) continue;
      return { ok: false, error: "request-failed" };
    }
    if (providerError(payload)) return { ok: false, error: "request-failed" };

    options.onPhase?.({ phase: "writing", label });
    const text = extractModelText(payload);
    if (text == null || text.trim() === "") continue;

    let questions: unknown;
    try {
      questions = parseModelQuestions(text);
    } catch {
      continue;
    }

    options.onPhase?.({ phase: "checking", label });
    const result = validateQuiz({
      videoId: options.job.videoId,
      startMs: options.job.startMs,
      endMs: options.job.endMs,
      cues: options.job.cues,
      expectedCount: options.job.questionsPerStop,
      questions,
    });
    if (result.ok) return { ok: true, quiz: result.quiz };
  }
  return { ok: false, error: "invalid-quiz" };
}

function configCode(error: unknown): QuizRunError {
  if (error instanceof ProviderConfigError) return error.code;
  return "request-failed";
}

function httpCode(error: unknown): "request-failed" | "unauthorized" | "timed-out" | null {
  if (!(error instanceof Error) || error.name !== "HttpFailure") return null;
  const code = (error as { code?: unknown }).code;
  if (code === "unauthorized" || code === "request-failed" || code === "timed-out") return code;
  return null;
}

function providerError(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as { error?: unknown };
  return record.error != null && extractModelText(payload) == null;
}
