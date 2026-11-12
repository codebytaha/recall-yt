import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Cue } from "../src/shared/types.ts";
import { validateQuiz, type ValidateQuizInput } from "../src/shared/validate-quiz.ts";

const cues: Cue[] = [
  { startMs: 0, endMs: 5_000, text: "mitochondria make energy in cells" },
  { startMs: 5_000, endMs: 10_000, text: "chloroplasts harvest light in plants" },
  { startMs: 20_000, endMs: 21_000, text: "secret outside fact" },
];

const windowInput = {
  videoId: "video-1",
  startMs: 0,
  endMs: 10_000,
  cues,
  expectedCount: 2,
} as const;

function question(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "q1",
    prompt: "What makes energy in cells?",
    choices: ["mitochondria", "chloroplasts", "plants", "light"],
    correctIndex: 0,
    sourceStartMs: 0,
    sourceEndMs: 5_000,
    sourceExcerpt: "mitochondria make energy",
    ...overrides,
  };
}

function secondQuestion(): Record<string, unknown> {
  return {
    id: "q2",
    prompt: "What harvests light in plants?",
    choices: ["cells", "chloroplasts", "energy", "mitochondria"],
    correctIndex: 1,
    sourceStartMs: 5_000,
    sourceEndMs: 10_000,
    sourceExcerpt: "chloroplasts harvest light",
  };
}

function validate(questions: unknown, overrides: Partial<ValidateQuizInput> = {}) {
  return validateQuiz({
    ...windowInput,
    questions,
    random: () => 0,
    ...overrides,
  });
}

describe("validateQuiz", () => {
  test("rejects an excerpt that is not in the window cues", () => {
    const missing = validate([
      question({ sourceExcerpt: "secret outside fact" }),
      secondQuestion(),
    ]);
    const blank = validate([question({ sourceExcerpt: "   " }), secondQuestion()]);

    assert.equal(missing.ok, false);
    assert.equal(blank.ok, false);
    if (!missing.ok) assert.match(missing.reason, /sourceExcerpt/);
    if (!blank.ok) assert.match(blank.reason, /sourceExcerpt/);
  });

  test("rejects a correctIndex outside 0..3", () => {
    for (const correctIndex of [4, -1, 1.5, "0"]) {
      const result = validate([question({ correctIndex }), secondQuestion()]);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /correctIndex/);
    }
  });

  test("rejects a source range outside the window", () => {
    const pastEnd = validate([
      question({ sourceStartMs: 0, sourceEndMs: 10_001 }),
      secondQuestion(),
    ]);
    const beforeStart = validate([
      question({ sourceStartMs: -1, sourceEndMs: 5_000 }),
      secondQuestion(),
    ]);

    assert.equal(pastEnd.ok, false);
    assert.equal(beforeStart.ok, false);
    if (!pastEnd.ok) assert.match(pastEnd.reason, /outside the window/);
    if (!beforeStart.ok) assert.match(beforeStart.reason, /outside the window/);
  });

  test("rejects the wrong question count, a short choice list, and duplicate choices", () => {
    const count = validate([question()]);
    const short = validate([
      question({ choices: ["mitochondria", "chloroplasts", "plants"] }),
      secondQuestion(),
    ]);
    const duplicates = validate([
      question({ choices: ["mitochondria", "mitochondria", "plants", "light"] }),
      secondQuestion(),
    ]);

    assert.equal(count.ok, false);
    assert.equal(short.ok, false);
    assert.equal(duplicates.ok, false);
    if (!count.ok) assert.match(count.reason, /expected 2 questions/);
    if (!short.ok) assert.match(short.reason, /4 choices/);
    if (!duplicates.ok) assert.match(duplicates.reason, /distinct/);
  });

  test("accepts an excerpt once whitespace is normalized", () => {
    const spaced: Cue[] = [
      { startMs: 0, endMs: 5_000, text: "mitochondria   make\nenergy in cells" },
      { startMs: 5_000, endMs: 10_000, text: "chloroplasts harvest light in plants" },
    ];
    const result = validate(
      [question({ sourceExcerpt: "mitochondria make energy" }), secondQuestion()],
      { cues: spaced },
    );

    assert.equal(result.ok, true);
  });

  test("returns a valid quiz with questions and choices shuffled, as plain text", () => {
    const taggedPrompt = "What does <b>mitochondria</b> do? AT&amp;P stays literal.";
    const result = validate([
      question({ prompt: taggedPrompt, sourceExcerpt: "mitochondria make energy" }),
      secondQuestion(),
    ]);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.quiz.videoId, "video-1");
    assert.equal(result.quiz.startMs, 0);
    assert.equal(result.quiz.endMs, 10_000);
    assert.deepEqual(
      result.quiz.questions.map((item) => item.id),
      ["q2", "q1"],
    );

    const first = result.quiz.questions[0];
    const second = result.quiz.questions[1];
    assert.ok(first);
    assert.ok(second);

    assert.deepEqual(first.choices, ["chloroplasts", "energy", "mitochondria", "cells"]);
    assert.equal(first.correctIndex, 0);
    assert.equal(first.choices[first.correctIndex], "chloroplasts");

    assert.deepEqual(second.choices, ["chloroplasts", "plants", "light", "mitochondria"]);
    assert.equal(second.correctIndex, 3);
    assert.equal(second.choices[second.correctIndex], "mitochondria");
    assert.equal(second.prompt, taggedPrompt);
    assert.equal(second.sourceExcerpt, "mitochondria make energy");
  });

  test("rejects a choice that is much longer than the other three", () => {
    const result = validate([
      question({
        choices: [
          "ATP",
          "DNA",
          "The mitochondria produce ATP by oxidative phosphorylation along the inner membrane of the cell",
          "RNA",
        ],
      }),
      secondQuestion(),
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /much longer/);
  });

  test("rejects a choice that explains itself while the others do not", () => {
    const result = validate([
      question({
        choices: [
          "ATP because it stores energy",
          "stored sugar",
          "cell wall lipid",
          "plant pigment",
        ],
      }),
      secondQuestion(),
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /explains itself/);
  });

  test("rejects all of the above", () => {
    const result = validate([
      question({
        choices: ["ATP", "DNA", "RNA", "all of the above"],
      }),
      secondQuestion(),
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /giveaway/);
  });
});
