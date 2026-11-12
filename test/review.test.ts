import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cardFromQuestion, dueCards, gradeCard } from "../src/shared/review.ts";
import type { Question } from "../src/shared/types.ts";

const now = 1_700_000_000_000;
const day = 86_400_000;

const question: Question = {
  id: "q1",
  prompt: "What does i start at?",
  choices: ["0", "1", "n", "n - 1"],
  correctIndex: 0,
  sourceStartMs: 0,
  sourceEndMs: 4_000,
  sourceExcerpt: "i starts at 0",
};

describe("review cards", () => {
  test("a miss is due again in 10 minutes and a hit waits a day", () => {
    const missed = cardFromQuestion("vid", question, false, now);
    const hit = cardFromQuestion("vid", question, true, now);

    assert.equal(missed.dueAt, now + 10 * 60 * 1000);
    assert.equal(missed.reps, 0);
    assert.equal(missed.lapses, 1);
    assert.equal(hit.dueAt, now + day);
    assert.equal(hit.reps, 1);
    assert.equal(hit.intervalDays, 1);
  });

  test("Good then Good waits six days, and Again brings the card back today", () => {
    const first = cardFromQuestion("vid", question, true, now);
    const second = gradeCard(first, "good", first.dueAt);
    assert.equal(second.intervalDays, 6);
    assert.equal(second.dueAt, first.dueAt + 6 * day);

    const forgotten = gradeCard(second, "again", second.dueAt);
    assert.equal(forgotten.reps, 0);
    assert.equal(forgotten.dueAt, second.dueAt + 10 * 60 * 1000);
    assert.equal(forgotten.lapses, 1);
  });

  test("only cards whose due time has arrived are listed, earliest first", () => {
    const later = cardFromQuestion("vid", { ...question, id: "later" }, true, now);
    const sooner = cardFromQuestion("vid", { ...question, id: "sooner" }, false, now);
    const waiting = gradeCard(later, "good", later.dueAt);

    const due = dueCards([waiting, later, sooner], now + 10 * 60 * 1000);
    assert.deepEqual(
      due.map((card) => card.questionId),
      ["sooner"],
    );
    assert.ok(due.every((card) => card.dueAt <= now + 10 * 60 * 1000));
  });
});
