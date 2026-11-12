/// <reference lib="dom" />

import type { Quiz } from "../shared/types.ts";
import { mountQuiz, type MountQuizHandle } from "../youtube/overlay.ts";

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

let mounted: MountQuizHandle | null = mountQuiz(parent, quiz, {
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
