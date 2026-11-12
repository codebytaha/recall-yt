/** Caption line in playback milliseconds. */
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

export type ProviderId = "openai" | "gemini" | "openai-compatible";

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60;
export const DEFAULT_INTERVAL_MINUTES = 10;
export const MIN_QUESTIONS_PER_STOP = 1;
export const MAX_QUESTIONS_PER_STOP = 8;
export const DEFAULT_QUESTIONS_PER_STOP = 4;

export interface Settings {
  /** 1–60. Default 10. */
  intervalMinutes: number;
  /** 1–8. Default 4. */
  questionsPerStop: number;
  provider: ProviderId;
  model: string;
  /** Sent only when provider is openai-compatible. */
  baseUrl: string;
  apiKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  questionsPerStop: DEFAULT_QUESTIONS_PER_STOP,
  provider: "openai",
  model: "",
  baseUrl: "",
  apiKey: "",
};

export interface Question {
  id: string;
  prompt: string;
  choices: readonly [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceExcerpt: string;
}

export interface Quiz {
  videoId: string;
  startMs: number;
  endMs: number;
  questions: Question[];
}

export interface Attempt {
  questionId: string;
  chosenIndex: number;
  correct: boolean;
  atMs: number;
}

export type CheckpointStatus = "pending" | "quizzed" | "skipped";

export type SkipReason = "too-little-speech";

export interface Checkpoint {
  videoId: string;
  startMs: number;
  endMs: number;
  status: CheckpointStatus;
  skipReason?: SkipReason;
}

export interface VideoMemory {
  videoId: string;
  checkpoints: Checkpoint[];
  quizzes: Quiz[];
  attempts: Attempt[];
  missedQuestionIds: string[];
  endRecapDone: boolean;
}

export function emptyVideoMemory(videoId: string): VideoMemory {
  return {
    videoId,
    checkpoints: [],
    quizzes: [],
    attempts: [],
    missedQuestionIds: [],
    endRecapDone: false,
  };
}
