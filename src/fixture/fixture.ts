/// <reference lib="dom" />

import type { Quiz } from "../shared/types.ts";
import {
  markCalling,
  markChecking,
  markWriting,
  openWait,
  withElapsed,
  type WaitSnapshot,
} from "../shared/progress.ts";
import { mountProgress, mountQuiz, viewFromWait, type MountQuizHandle, type ProgressButton, type ProgressHandle } from "../youtube/overlay.ts";

const quiz: Quiz = {
  videoId: "fixture-video",
  startMs: 0,
  endMs: 120_000,
  questions: [
    {
      id: "playhead",
      prompt: "What does the speaker say the quiz clock follows?",
      choices: [
        "The wall clock on the desk",
        "The video playhead",
        "A ten-minute kitchen timer",
        "The time in the tab title",
      ],
      correctIndex: 1,
      sourceStartMs: 4_000,
      sourceEndMs: 12_000,
      sourceExcerpt: "The clock is the playhead, not the wall.",
    },
    {
      id: "feedback",
      prompt: "When does the speaker say the result should appear?",
      choices: [
        "While the choices are still hidden",
        "As soon as the video pauses",
        "After an answer is committed",
        "Only at the end of the video",
      ],
      correctIndex: 2,
      sourceStartMs: 40_000,
      sourceEndMs: 52_000,
      sourceExcerpt: "Feedback waits until an answer is committed.",
    },
  ],
};

const parent = document.querySelector("#quiz");
if (!(parent instanceof HTMLElement)) {
  throw new Error("quiz fixture is missing #quiz");
}

const log = document.querySelector("#log");

function note(text: string): void {
  if (log instanceof HTMLElement) log.textContent = text;
}

let mounted: MountQuizHandle | null = null;
let progress: ProgressHandle | null = null;

function showQuiz(): void {
  progress?.destroy();
  progress = null;
  mounted = mountQuiz(parent, quiz, {
    onAnswer(question, chosenIndex) {
      const correct = chosenIndex === question.correctIndex;
      note(`${correct ? "Correct" : "Missed"} on ${question.id}, choice ${chosenIndex + 1}.`);
    },
    onReplay(question) {
      const atMs = Math.max(0, question.sourceStartMs - 2_000);
      note(`Replay this moment at ${atMs} ms.`);
    },
    onContinue() {
      note("Continue resumes playback.");
      mounted?.destroy();
      mounted = null;
    },
    onDismiss() {
      note("Not watching. Dismissed without scoring.");
      mounted?.destroy();
      mounted = null;
    },
  });
  note("Answer with keys 1–4, then replay or continue.");
}

const buttons: ProgressButton[] = [
  {
    label: "Not watching",
    secondary: true,
    onClick() {
      note("Not watching. Dismissed without scoring.");
      window.clearInterval(timer);
      showQuiz();
    },
  },
];

let wait: WaitSnapshot = openWait({
  providerLabel: "OpenAI",
  lineCount: 12,
  startMs: 600_000,
  endMs: 1_200_000,
});
progress = mountProgress(parent, viewFromWait(wait, buttons));
note("Getting the transcript.");

const frames: Array<(current: WaitSnapshot) => WaitSnapshot> = [
  (current) => markCalling(current, "OpenAI"),
  (current) => withElapsed(current, 2),
  (current) => markWriting(current),
  (current) => markChecking(current),
];

let frame = 0;
const timer = window.setInterval(() => {
  if (frame >= frames.length) {
    window.clearInterval(timer);
    showQuiz();
    return;
  }
  const advance = frames[frame];
  frame += 1;
  if (!advance) return;
  wait = advance(wait);
  progress?.update(viewFromWait(wait, buttons));
  const current = wait.steps.find((step) => step.status === "current");
  if (current) note(current.title);
}, 700);
