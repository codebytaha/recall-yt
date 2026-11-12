import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Cue } from "../src/shared/types.ts";
import {
  MIN_SPEECH_WORDS,
  resolvePlayback,
  sliceCues,
  type PlaybackSample,
} from "../src/shared/windows.ts";

const INTERVAL_MS = 10 * 60 * 1000;

function words(count: number, startMs: number, endMs: number): Cue {
  return {
    startMs,
    endMs,
    text: Array.from({ length: count }, (_, index) => `w${index}`).join(" "),
  };
}

function sample(overrides: Partial<PlaybackSample> & Pick<PlaybackSample, "cues" | "previousTimeMs" | "currentTimeMs" | "nextStopMs">): PlaybackSample {
  return {
    videoId: "video-1",
    intervalMs: INTERVAL_MS,
    finished: [],
    ...overrides,
  };
}

describe("sliceCues", () => {
  test("keeps cues that overlap the window and drops cues that only touch an endpoint", () => {
    const cues: Cue[] = [
      { startMs: 0, endMs: 1_000, text: "ends at the start" },
      { startMs: 500, endMs: 1_500, text: "crosses the start" },
      { startMs: 2_000, endMs: 3_000, text: "fully inside" },
      { startMs: 5_000, endMs: 6_000, text: "ends at the end" },
      { startMs: 5_500, endMs: 7_000, text: "crosses the end" },
      { startMs: 6_000, endMs: 6_500, text: "starts at the end" },
      { startMs: 8_000, endMs: 9_000, text: "after the window" },
    ];
    const before = cues.map((cue) => ({ ...cue }));

    const sliced = sliceCues(cues, 1_000, 6_000);

    assert.deepEqual(
      sliced.map((cue) => cue.text),
      ["crosses the start", "fully inside", "ends at the end", "crosses the end"],
    );
    assert.deepEqual(cues, before);
    assert.deepEqual(sliceCues(cues, 6_000, 6_000), []);
  });
});

describe("resolvePlayback", () => {
  test("does not open a checkpoint before playback reaches the next stop", () => {
    const started = Date.now();
    const decision = resolvePlayback(
      sample({
        cues: [words(80, 0, INTERVAL_MS)],
        previousTimeMs: 0,
        currentTimeMs: 5_000,
        nextStopMs: INTERVAL_MS,
      }),
    );

    assert.equal(decision.checkpoint, null);
    assert.equal(decision.nextStopMs, INTERVAL_MS);
    assert.ok(Date.now() - started < 2_000);
  });

  test("seeking forward quizzes only the interval that came due", () => {
    const currentTimeMs = 2_500_000;
    const decision = resolvePlayback(
      sample({
        cues: [words(80, 0, 3_000_000)],
        previousTimeMs: 30_000,
        currentTimeMs,
        nextStopMs: INTERVAL_MS,
      }),
    );

    assert.ok(decision.checkpoint);
    assert.equal(decision.checkpoint.status, "pending");
    assert.equal(decision.checkpoint.startMs, 0);
    assert.equal(decision.checkpoint.endMs, INTERVAL_MS);
    assert.notEqual(decision.checkpoint.endMs, currentTimeMs);
    assert.equal(decision.nextStopMs, currentTimeMs + INTERVAL_MS);
    assert.equal(decision.checkpoint.skipReason, undefined);
  });

  test("skips a window under 40 words and does not borrow speech from the seeked-over stretch", () => {
    assert.equal(MIN_SPEECH_WORDS, 40);
    const currentTimeMs = 2_500_000;
    const decision = resolvePlayback(
      sample({
        cues: [
          words(MIN_SPEECH_WORDS - 1, 0, INTERVAL_MS),
          words(200, INTERVAL_MS, currentTimeMs),
        ],
        previousTimeMs: 1_000,
        currentTimeMs,
        nextStopMs: INTERVAL_MS,
      }),
    );

    assert.deepEqual(decision.checkpoint, {
      videoId: "video-1",
      startMs: 0,
      endMs: INTERVAL_MS,
      status: "skipped",
      skipReason: "too-little-speech",
    });
    assert.equal(decision.nextStopMs, currentTimeMs + INTERVAL_MS);
  });

  test("quizzes a window of exactly 40 words", () => {
    const decision = resolvePlayback(
      sample({
        cues: [
          words(20, 0, 300_000),
          words(20, 300_000, INTERVAL_MS),
        ],
        previousTimeMs: INTERVAL_MS - 1_000,
        currentTimeMs: INTERVAL_MS,
        nextStopMs: INTERVAL_MS,
      }),
    );

    assert.equal(decision.checkpoint?.status, "pending");
    assert.equal(decision.checkpoint?.startMs, 0);
    assert.equal(decision.checkpoint?.endMs, INTERVAL_MS);
    assert.equal(decision.nextStopMs, INTERVAL_MS + INTERVAL_MS);
  });

  test("seeking backward does not re-quiz a finished window", () => {
    const decision = resolvePlayback(
      sample({
        cues: [words(80, 0, INTERVAL_MS * 2)],
        previousTimeMs: 700_000,
        currentTimeMs: 100_000,
        nextStopMs: INTERVAL_MS * 2,
        finished: [{ startMs: 0, endMs: INTERVAL_MS }],
      }),
    );

    assert.equal(decision.checkpoint, null);
    assert.equal(decision.nextStopMs, INTERVAL_MS * 2);
  });

  test("landing forward on a finished window advances the clock without a second quiz", () => {
    const currentTimeMs = 700_000;
    const decision = resolvePlayback(
      sample({
        cues: [words(80, 0, INTERVAL_MS)],
        previousTimeMs: 0,
        currentTimeMs,
        nextStopMs: INTERVAL_MS,
        finished: [{ startMs: 0, endMs: INTERVAL_MS }],
      }),
    );

    assert.equal(decision.checkpoint, null);
    assert.equal(decision.nextStopMs, currentTimeMs + INTERVAL_MS);
  });
});
