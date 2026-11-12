import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildQuizPrompt } from "../src/shared/prompt.ts";
import type { Cue } from "../src/shared/types.ts";

const cues: Cue[] = [
  { startMs: 0, endMs: 4_000, text: "a for loop repeats until the counter reaches n" },
  { startMs: 4_000, endMs: 8_000, text: "the body runs once per value of i" },
];

describe("buildQuizPrompt", () => {
  test("asks for practice in the subject's form and keeps the cue text", () => {
    const prompt = buildQuizPrompt({
      cues,
      startMs: 0,
      endMs: 8_000,
      questionCount: 3,
    });

    assert.match(prompt, /coding/);
    assert.match(prompt, /math/);
    assert.match(prompt, /algorithms/);
    assert.match(prompt, /language learning/);
    assert.match(prompt, /similar length/);
    assert.match(prompt, /a for loop repeats until the counter reaches n/);
    assert.match(prompt, /Write exactly 3 questions/);
    assert.equal(prompt.includes("<b>"), false);
  });
});
