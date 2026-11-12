import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runQuizGeneration } from "../src/background/quiz-run.ts";
import {
  failWait,
  markCalling,
  markChecking,
  markRetry,
  markWriting,
  openWait,
  providerLabel,
  withElapsed,
} from "../src/shared/progress.ts";
import type { Cue, Settings } from "../src/shared/types.ts";

const cues: Cue[] = [
  { startMs: 0, endMs: 5_000, text: "mitochondria make energy in cells" },
  { startMs: 5_000, endMs: 10_000, text: "chloroplasts harvest light in plants" },
];

const settings: Settings = {
  intervalMinutes: 10,
  questionsPerStop: 2,
  provider: "openai",
  model: "gpt-test",
  baseUrl: "",
  apiKey: "sk-test",
};

function questions(): unknown[] {
  return [
    {
      id: "q1",
      prompt: "What makes energy in cells?",
      choices: ["mitochondria", "chloroplasts", "plants", "light"],
      correctIndex: 0,
      sourceStartMs: 0,
      sourceEndMs: 5_000,
      sourceExcerpt: "mitochondria make energy",
    },
    {
      id: "q2",
      prompt: "What harvests light in plants?",
      choices: ["cells", "chloroplasts", "energy", "mitochondria"],
      correctIndex: 1,
      sourceStartMs: 5_000,
      sourceEndMs: 10_000,
      sourceExcerpt: "chloroplasts harvest light",
    },
  ];
}

function reply(body: unknown): unknown {
  return { choices: [{ message: { content: JSON.stringify({ questions: body }) } }] };
}

describe("wait steps", () => {
  test("names the connected API", () => {
    assert.equal(providerLabel({ provider: "openai", baseUrl: "" }), "OpenAI");
    assert.equal(providerLabel({ provider: "gemini", baseUrl: "" }), "Gemini");
    assert.equal(
      providerLabel({ provider: "openai-compatible", baseUrl: "https://api.example.com/v1" }),
      "api.example.com",
    );
    assert.equal(providerLabel({ provider: "openai-compatible", baseUrl: "not a url" }), "the saved endpoint");
  });

  test("moves one real step at a time", () => {
    const opened = openWait({
      providerLabel: "OpenAI",
      lineCount: 2,
      startMs: 600_000,
      endMs: 1_200_000,
    });
    assert.equal(opened.title, "10:00 to 20:00");
    assert.equal(opened.steps[0]?.status, "current");
    assert.equal(opened.steps[0]?.detail, "2 lines from this stretch");

    const calling = markCalling(opened, "OpenAI");
    assert.equal(calling.steps[0]?.status, "done");
    assert.equal(calling.steps[1]?.status, "current");
    assert.equal(calling.steps[1]?.title, "Calling OpenAI");

    const elapsed = withElapsed(calling, 3);
    assert.equal(elapsed.steps[1]?.detail, "Waiting for the reply, 3 seconds");
    assert.equal(withElapsed(calling, 0), calling);

    const writing = markWriting(calling);
    assert.equal(writing.steps[1]?.status, "done");
    assert.equal(writing.steps[2]?.status, "current");
    assert.equal(writing.steps[2]?.title, "Writing the questions");

    const checking = markChecking(writing);
    assert.equal(checking.steps[3]?.status, "current");
    assert.equal(checking.steps[3]?.title, "Checking the questions");

    const retry = markRetry(checking, "Gemini");
    assert.equal(retry.note, "That reply didn't match the captions. Trying again.");
    assert.equal(retry.steps[1]?.status, "current");
    assert.equal(retry.steps[1]?.title, "Calling Gemini");
    assert.equal(retry.steps[2]?.status, "waiting");

    const failed = failWait(checking, "checking", "The reply didn't match this stretch.");
    assert.equal(failed.steps[2]?.status, "done");
    assert.equal(failed.steps[3]?.status, "failed");
    assert.equal(failed.note, "The reply didn't match this stretch.");
  });
});

describe("runQuizGeneration", () => {
  test("reports calling, writing, then checking before a quiz", async () => {
    const phases: string[] = [];
    const result = await runQuizGeneration({
      settings,
      job: {
        videoId: "video-1",
        startMs: 0,
        endMs: 10_000,
        cues,
        questionsPerStop: 2,
      },
      call: async () => reply(questions()),
      onPhase(notice) {
        phases.push(notice.phase);
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(phases, ["calling", "writing", "checking"]);
  });

  test("tries again when the first reply misses the captions", async () => {
    const phases: string[] = [];
    let calls = 0;
    const bad = questions();
    bad[0] = { ...(bad[0] as object), sourceExcerpt: "not in the captions" };
    const result = await runQuizGeneration({
      settings,
      job: {
        videoId: "video-1",
        startMs: 0,
        endMs: 10_000,
        cues,
        questionsPerStop: 2,
      },
      call: async () => {
        calls += 1;
        return reply(calls === 1 ? bad : questions());
      },
      onPhase(notice) {
        phases.push(`${notice.phase}:${notice.label}`);
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    assert.deepEqual(phases, [
      "calling:OpenAI",
      "writing:OpenAI",
      "checking:OpenAI",
      "retrying:OpenAI",
      "writing:OpenAI",
      "checking:OpenAI",
    ]);
  });

  test("stops before the call when the key is missing", async () => {
    const phases: string[] = [];
    const result = await runQuizGeneration({
      settings: { ...settings, apiKey: "  " },
      job: {
        videoId: "video-1",
        startMs: 0,
        endMs: 10_000,
        cues,
        questionsPerStop: 2,
      },
      call: async () => {
        throw new Error("should not call");
      },
      onPhase(notice) {
        phases.push(notice.phase);
      },
    });

    assert.deepEqual(result, { ok: false, error: "missing-key" });
    assert.deepEqual(phases, []);
  });
});
