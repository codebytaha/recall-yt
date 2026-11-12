import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Cue } from "../src/shared/types.ts";
import { parseTimedtextJson } from "../src/youtube/parse-timedtext.ts";

describe("parseTimedtextJson", () => {
  test("parses a JSON3 payload into cues", () => {
    const body = JSON.stringify({
      wireMagic: "pb3",
      events: [
        {
          tStartMs: 1_200,
          dDurationMs: 1_800,
          segs: [{ utf8: "Hello" }, { utf8: " there" }],
        },
        {
          tStartMs: 3_000,
          dDurationMs: 500,
          segs: [{ utf8: "Next line" }],
        },
      ],
    });

    const cues: Cue[] = parseTimedtextJson(body);

    assert.deepEqual(cues, [
      { startMs: 1_200, endMs: 3_000, text: "Hello there" },
      { startMs: 3_000, endMs: 3_500, text: "Next line" },
    ]);
  });

  test("skips events with empty segs", () => {
    const body = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1_000, segs: [] },
        { tStartMs: 1_000, dDurationMs: 1_000, segs: [{ utf8: "" }] },
        { tStartMs: 2_000, dDurationMs: 400 },
        { tStartMs: 2_400, dDurationMs: 600, segs: [{ utf8: "\n" }] },
        { tStartMs: 3_000, dDurationMs: 500, segs: [{ utf8: "kept" }] },
      ],
    });

    assert.deepEqual(parseTimedtextJson(body), [
      { startMs: 3_000, endMs: 3_500, text: "kept" },
    ]);
  });

  test("concatenates word segments in order", () => {
    const body = JSON.stringify({
      events: [
        {
          tStartMs: 100,
          dDurationMs: 900,
          segs: [{ utf8: "cap" }, { utf8: "tions" }, { utf8: " " }, { utf8: "work" }],
        },
      ],
    });

    assert.deepEqual(parseTimedtextJson(body), [
      { startMs: 100, endMs: 1_000, text: "captions work" },
    ]);
  });

  test("returns an empty list for invalid JSON", () => {
    const samples = [
      "{",
      "not json",
      "",
      "   ",
      "<transcript><text start=\"0\" dur=\"1\">Hi</text></transcript>",
      "  <?xml version=\"1.0\"?><transcript></transcript>",
    ];

    for (const sample of samples) {
      let cues: Cue[] | undefined;
      assert.doesNotThrow(() => {
        cues = parseTimedtextJson(sample);
      });
      assert.deepEqual(cues, []);
    }
  });
});
