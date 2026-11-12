import type { Question } from "./types.ts";

/** Anki SM-2, with three grades. Again comes back in 10 minutes. Good and Easy wait in days. */
export const RECALL_CARDS_KEY = "recallCards";

const DAY_MS = 86_400_000;
const AGAIN_MS = 10 * 60 * 1000;
const MIN_EASE = 1.3;
const START_EASE = 2.5;

export type ReviewGrade = "again" | "good" | "easy";

export interface ReviewCard {
  id: string;
  videoId: string;
  questionId: string;
  prompt: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  sourceExcerpt: string;
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  dueAt: number;
}

export function cardId(videoId: string, questionId: string): string {
  return `${videoId}:${questionId}`;
}

export function dueCards(cards: readonly ReviewCard[], now: number): ReviewCard[] {
  return cards
    .filter((card) => card.dueAt <= now)
    .sort((left, right) => left.dueAt - right.dueAt || left.id.localeCompare(right.id));
}

export function gradeCard(card: ReviewCard, grade: ReviewGrade, now: number): ReviewCard {
  const quality = grade === "again" ? 1 : grade === "good" ? 4 : 5;
  const ease = Math.max(
    MIN_EASE,
    card.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );
  if (quality < 3) {
    return {
      ...card,
      ease,
      reps: 0,
      intervalDays: 0,
      lapses: card.lapses + 1,
      dueAt: now + AGAIN_MS,
    };
  }
  const reps = card.reps + 1;
  let intervalDays = card.intervalDays;
  if (reps === 1) intervalDays = grade === "easy" ? 4 : 1;
  else if (reps === 2) intervalDays = 6;
  else intervalDays = Math.max(1, Math.round(intervalDays * ease));
  if (grade === "easy" && reps > 1) intervalDays = Math.max(1, Math.round(intervalDays * 1.3));
  return {
    ...card,
    ease,
    reps,
    intervalDays,
    lapses: card.lapses,
    dueAt: now + intervalDays * DAY_MS,
  };
}

export function cardFromQuestion(
  videoId: string,
  question: Question,
  correct: boolean,
  now: number,
): ReviewCard {
  const fresh: ReviewCard = {
    id: cardId(videoId, question.id),
    videoId,
    questionId: question.id,
    prompt: question.prompt,
    choices: [question.choices[0], question.choices[1], question.choices[2], question.choices[3]],
    correctIndex: question.correctIndex,
    sourceExcerpt: question.sourceExcerpt,
    ease: START_EASE,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: now,
  };
  return gradeCard(fresh, correct ? "good" : "again", now);
}

export function readCardStore(value: unknown): Record<string, ReviewCard> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const store: Record<string, ReviewCard> = {};
  for (const [id, raw] of Object.entries(value)) {
    const card = readCard(id, raw);
    if (card) store[id] = card;
  }
  return store;
}

function readCard(id: string, value: unknown): ReviewCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.videoId !== "string" || typeof raw.questionId !== "string") return null;
  if (typeof raw.prompt !== "string" || typeof raw.sourceExcerpt !== "string") return null;
  if (!Array.isArray(raw.choices) || raw.choices.length !== 4) return null;
  if (!raw.choices.every((choice) => typeof choice === "string")) return null;
  const correctIndex = raw.correctIndex;
  if (correctIndex !== 0 && correctIndex !== 1 && correctIndex !== 2 && correctIndex !== 3) return null;
  const ease = numberOr(raw.ease, START_EASE);
  const intervalDays = numberOr(raw.intervalDays, 0);
  const reps = numberOr(raw.reps, 0);
  const lapses = numberOr(raw.lapses, 0);
  const dueAt = numberOr(raw.dueAt, 0);
  return {
    id,
    videoId: raw.videoId,
    questionId: raw.questionId,
    prompt: raw.prompt,
    choices: [raw.choices[0], raw.choices[1], raw.choices[2], raw.choices[3]],
    correctIndex,
    sourceExcerpt: raw.sourceExcerpt,
    ease,
    intervalDays,
    reps,
    lapses,
    dueAt,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
