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
  prompt: "a task that practices the idea, not a quote of the caption",
  choices: [
    "parallel option of similar length",
    "parallel option of similar length",
    "parallel option of similar length",
    "parallel option of similar length",
  ],
  correctIndex: 0,
  sourceStartMs: 0,
  sourceEndMs: 0,
  sourceExcerpt: "exact substring copied from the cues",
} as const;

/**
 * Instructions for one window.
 * The model must practice the claim in the stretch, in that subject's own form,
 * and return strict JSON. Cue text is inserted as text.
 */
export function buildQuizPrompt(input: QuizPromptInput): string {
  const cues = sliceCues(input.cues, input.startMs, input.endMs);
  const cueBlock =
    cues.length === 0
      ? "(no cues in this window)"
      : cues.map((cue) => `[${cue.startMs}-${cue.endMs}] ${cue.text}`).join("\n");

  return [
    "Write a retrieval-practice quiz for one stretch of a lesson.",
    "Read the cues first and decide what the speaker is trying to make understood. Name that claim to yourself. Do not print the name.",
    "Use the same language as the captions.",
    "Write items that practice that claim in the subject's own form.",
    "If the stretch is about coding, use a short snippet, an output, or a bug that uses only the construct they explained.",
    "If the stretch is about math, use a short expression or a numeric step in the form they used.",
    "If the stretch is about algorithms, use a next step, a state, or a small trace.",
    "If the stretch is language learning, use a short production or meaning item in that language.",
    "For any other subject, use a worked instance of the idea.",
    "Do not ask what the speaker said, and do not start an item with according to the video.",
    "Every item must still be decidable from the cues alone. Do not import facts from outside this stretch.",
    "Each question has exactly one correct choice and three wrong choices.",
    "The four choices are the same kind of object. Four snippets, four numbers, four next steps, or four phrases.",
    "Keep the four choices at a similar length and in the same grammar.",
    "Do not let the correct choice be the long one, the explained one, or the only one that uses the speaker's terms.",
    "No choice may explain itself. Do not use because, which means, all of the above, or none of the above.",
    "Do not write a question that is a copied sentence with a blank.",
    "Write plain text only. Do not use HTML.",
    `Write exactly ${input.questionCount} questions.`,
    "Vary the items. Do not make every item the same kind of recall.",
    `The playback window is startMs ${input.startMs} through endMs ${input.endMs}.`,
    "Copy sourceExcerpt from the cues. The excerpt is the evidence, not the text of the correct choice.",
    "Put sourceStartMs and sourceEndMs inside the window.",
    "Respond with strict JSON only, no markdown. The value is an array of objects matching this Question shape:",
    JSON.stringify([QUESTION_SHAPE], null, 2),
    "",
    "Cues:",
    cueBlock,
  ].join("\n");
}
