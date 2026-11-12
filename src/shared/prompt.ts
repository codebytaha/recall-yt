import { sliceCues } from "./windows.ts";
import type { Cue } from "./types.ts";

export interface QuizPromptInput {
  cues: readonly Cue[];
  startMs: number;
  endMs: number;
  questionCount: number;
}

const QUESTION_SHAPE = {
  id: "q1",
  prompt: "plain text question",
  choices: ["one correct choice", "plausible wrong choice", "plausible wrong choice", "plausible wrong choice"],
  correctIndex: 0,
  sourceStartMs: 0,
  sourceEndMs: 0,
  sourceExcerpt: "exact substring copied from the cues",
} as const;

/**
 * Instructions for one window. The model is told to answer only from these cues
 * and to return strict JSON in the Question shape. Cue text is inserted as text.
 */
export function buildQuizPrompt(input: QuizPromptInput): string {
  const cues = sliceCues(input.cues, input.startMs, input.endMs);
  const cueBlock =
    cues.length === 0
      ? "(no cues in this window)"
      : cues.map((cue) => `[${cue.startMs}-${cue.endMs}] ${cue.text}`).join("\n");

  return [
    "Write a multiple-choice recall quiz.",
    "Every question must be answerable only from the cues below.",
    "Use the same language as the captions.",
    "Each question has exactly one correct choice and three plausible wrong choices from this stretch of speech.",
    "Do not write a question that is a copied sentence with a blank.",
    "Write plain text only. Do not use HTML.",
    `Write exactly ${input.questionCount} questions.`,
    `The playback window is startMs ${input.startMs} through endMs ${input.endMs}.`,
    "Copy sourceExcerpt from the cues.",
    "Put sourceStartMs and sourceEndMs inside the window.",
    "Respond with strict JSON only, no markdown. The value is an array of objects matching this Question shape:",
    JSON.stringify([QUESTION_SHAPE], null, 2),
    "",
    "Cues:",
    cueBlock,
  ].join("\n");
}
