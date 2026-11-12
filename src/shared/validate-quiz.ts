import { sliceCues } from "./windows.ts";
import type { Cue, Question, Quiz } from "./types.ts";

/**
 * Ground a model quiz in the window's caption text.
 * Prompt, choices, and excerpts stay plain strings. This module never parses HTML.
 * A quiz that passes is returned with question order and choice order shuffled.
 */
export interface ValidateQuizInput {
  videoId: string;
  startMs: number;
  endMs: number;
  cues: readonly Cue[];
  expectedCount: number;
  /** Model JSON: an array of question objects. Not trusted. */
  questions: unknown;
  /** Uniform draw in [0, 1). Defaults to Math.random. */
  random?: () => number;
}

export type QuizValidation =
  | { ok: true; quiz: Quiz }
  | { ok: false; reason: string };

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Overlapping cue text, with whitespace runs collapsed to single spaces. */
export function windowCueText(cues: readonly Cue[], startMs: number, endMs: number): string {
  return normalizeWhitespace(
    sliceCues(cues, startMs, endMs)
      .map((cue) => cue.text)
      .join(" "),
  );
}

export function validateQuiz(input: ValidateQuizInput): QuizValidation {
  if (typeof input.videoId !== "string" || input.videoId.trim() === "") {
    return { ok: false, reason: "videoId is required" };
  }
  if (
    typeof input.startMs !== "number" ||
    typeof input.endMs !== "number" ||
    !Number.isFinite(input.startMs) ||
    !Number.isFinite(input.endMs) ||
    !(input.endMs > input.startMs)
  ) {
    return { ok: false, reason: "window range is invalid" };
  }
  if (!Number.isInteger(input.expectedCount) || input.expectedCount < 1) {
    return { ok: false, reason: "expectedCount must be a positive integer" };
  }
  if (!Array.isArray(input.questions)) {
    return { ok: false, reason: "questions must be an array" };
  }
  if (input.questions.length !== input.expectedCount) {
    return {
      ok: false,
      reason: `expected ${input.expectedCount} questions, got ${input.questions.length}`,
    };
  }

  const transcript = windowCueText(input.cues, input.startMs, input.endMs);
  const prepared: Question[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < input.questions.length; index += 1) {
    const read = readQuestion(input.questions[index], index, input, transcript, seenIds);
    if (!read.ok) return read;
    seenIds.add(read.question.id);
    prepared.push(read.question);
  }

  const random = input.random ?? Math.random;
  const questions = shuffle(prepared, random).map((question) => shuffleChoices(question, random));
  return {
    ok: true,
    quiz: {
      videoId: input.videoId,
      startMs: input.startMs,
      endMs: input.endMs,
      questions,
    },
  };
}

type ReadQuestion = { ok: true; question: Question } | { ok: false; reason: string };

function readQuestion(
  value: unknown,
  index: number,
  input: ValidateQuizInput,
  transcript: string,
  seenIds: ReadonlySet<string>,
): ReadQuestion {
  const label = `question ${index + 1}`;
  if (!isRecord(value)) return { ok: false, reason: `${label} is not an object` };

  const prompt = value.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { ok: false, reason: `${label} is missing a prompt` };
  }

  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length !== 4) {
    return { ok: false, reason: `${label} must have exactly 4 choices` };
  }
  if (!choices.every((choice) => typeof choice === "string" && choice.trim() !== "")) {
    return { ok: false, reason: `${label} has an empty choice` };
  }
  const choiceTexts = choices as [string, string, string, string];
  const distinct = new Set(choiceTexts.map((choice) => normalizeWhitespace(choice)));
  if (distinct.size !== 4) {
    return { ok: false, reason: `${label} choices must be distinct` };
  }
  const balance = choiceBalanceProblem(choiceTexts);
  if (balance !== null) {
    return { ok: false, reason: `${label} ${balance}` };
  }

  const correctIndex = value.correctIndex;
  if (!isChoiceIndex(correctIndex)) {
    return { ok: false, reason: `${label} correctIndex must be 0, 1, 2, or 3` };
  }

  const sourceStartMs = value.sourceStartMs;
  const sourceEndMs = value.sourceEndMs;
  if (
    typeof sourceStartMs !== "number" ||
    typeof sourceEndMs !== "number" ||
    !Number.isFinite(sourceStartMs) ||
    !Number.isFinite(sourceEndMs) ||
    !(sourceStartMs < sourceEndMs) ||
    sourceStartMs < input.startMs ||
    sourceEndMs > input.endMs
  ) {
    return { ok: false, reason: `${label} source range is outside the window` };
  }

  const sourceExcerpt = value.sourceExcerpt;
  if (typeof sourceExcerpt !== "string") {
    return { ok: false, reason: `${label} sourceExcerpt must be a string` };
  }
  const excerpt = normalizeWhitespace(sourceExcerpt);
  if (excerpt === "" || !transcript.includes(excerpt)) {
    return { ok: false, reason: `${label} sourceExcerpt is not in the window cues` };
  }

  const rawId = value.id;
  let id = typeof rawId === "string" ? rawId.trim() : "";
  if (rawId !== undefined && typeof rawId !== "string") {
    return { ok: false, reason: `${label} id must be a string` };
  }
  if (id === "") id = `q${index + 1}`;
  if (seenIds.has(id)) return { ok: false, reason: `duplicate question id ${id}` };

  return {
    ok: true,
    question: {
      id,
      prompt,
      choices: [choiceTexts[0], choiceTexts[1], choiceTexts[2], choiceTexts[3]],
      correctIndex,
      sourceStartMs,
      sourceEndMs,
      sourceExcerpt,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChoiceIndex(value: unknown): value is 0 | 1 | 2 | 3 {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** A choice set is balanced when no option stands out by length or by explaining itself. */
export function choiceBalanceProblem(choices: readonly string[]): string | null {
  const texts = choices.map((choice) => normalizeWhitespace(choice));
  if (texts.some(isGiveawayChoice)) {
    return "choices include a giveaway such as all of the above";
  }
  if (texts.filter(explainsItself).length === 1) {
    return "one choice explains itself and the others do not";
  }
  const lengths = texts.map((text) => text.length).sort((left, right) => left - right);
  const longest = lengths[lengths.length - 1] ?? 0;
  const next = lengths[lengths.length - 2] ?? 0;
  if (longest >= next + 15 && longest > next * 1.8) {
    return "one choice is much longer than the others";
  }
  return null;
}

function isGiveawayChoice(text: string): boolean {
  const lower = text.toLowerCase();
  return lower === "all of the above" || lower === "none of the above";
}

function explainsItself(text: string): boolean {
  return /\bbecause\b/iu.test(text) || /\bwhich means\b/iu.test(text);
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const draw = random();
    const j = Math.min(i, Math.max(0, Math.floor(draw * (i + 1))));
    const swap = next[i] as T;
    next[i] = next[j] as T;
    next[j] = swap;
  }
  return next;
}

function shuffleChoices(question: Question, random: () => number): Question {
  const order = shuffle([0, 1, 2, 3] as const, random);
  const choices = order.map((index) => question.choices[index]) as [
    string,
    string,
    string,
    string,
  ];
  const correctIndex = order.indexOf(question.correctIndex);
  if (!isChoiceIndex(correctIndex)) {
    throw new Error("shuffle dropped the correct choice");
  }
  return { ...question, choices, correctIndex };
}
