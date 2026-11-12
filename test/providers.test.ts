import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ProviderConfigError,
  buildProviderRequest,
  buildTestKeyRequest,
  extractModelText,
  parseModelQuestions,
} from "../src/background/providers.ts";
import { defaultSettings } from "../src/shared/defaults.ts";
import { buildQuizPrompt } from "../src/shared/prompt.ts";
import type { Cue, Settings } from "../src/shared/types.ts";

const OPENAI_KEY = "sk-recall-header-9f3c2a";
const GEMINI_KEY = "gemini-key-header-9f3c2a";

const cues: Cue[] = [
  { startMs: 0, endMs: 5_000, text: "mitochondria make energy in cells" },
];

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings,
    model: "gpt-4o-mini",
    apiKey: OPENAI_KEY,
    ...overrides,
  };
}

function assertHeadersStayOutOfUrl(url: string, headers: Record<string, string>, apiKey: string): void {
  const parsed = new URL(url);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(parsed.hash, "");
  assert.equal(parsed.href.includes(apiKey), false);
  assert.equal(parsed.href.includes("Bearer"), false);
  assert.equal(parsed.href.includes("x-goog-api-key"), false);
  for (const [name, value] of Object.entries(headers)) {
    assert.equal(parsed.searchParams.has(name), false);
    assert.equal(parsed.searchParams.has(name.toLowerCase()), false);
    assert.equal(parsed.href.includes(value), false);
    assert.equal(parsed.href.includes(name), false);
  }
}

describe("defaultSettings", () => {
  test("uses the product defaults and an empty key", () => {
    assert.deepEqual(defaultSettings, {
      intervalMinutes: 10,
      questionsPerStop: 4,
      activeModelId: "default",
      models: [
        {
          id: "default",
          name: "OpenAI",
          provider: "openai",
          model: "",
          baseUrl: "",
          apiKey: "",
        },
      ],
      provider: "openai",
      model: "",
      baseUrl: "",
      apiKey: "",
      name: "OpenAI",
    });
  });
});

describe("buildProviderRequest", () => {
  test("openai sends a bearer token and asks for a json object", () => {
    const prompt = buildQuizPrompt({
      cues,
      startMs: 0,
      endMs: 5_000,
      questionCount: 4,
    });
    const request = buildProviderRequest(
      settings({ provider: "openai", baseUrl: `https://evil.example/v1?key=${OPENAI_KEY}` }),
      prompt,
    );

    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.headers.Authorization, `Bearer ${OPENAI_KEY}`);
    assert.equal(request.headers["Content-Type"], "application/json");
    assert.equal(request.headers["x-goog-api-key"], undefined);

    const body = JSON.parse(request.body) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: { type: string };
    };
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.response_format.type, "json_object");
    assert.deepEqual(body.messages, [{ role: "user", content: prompt }]);
    assert.equal(request.body.includes(OPENAI_KEY), false);
    assertHeadersStayOutOfUrl(request.url, request.headers, OPENAI_KEY);
  });

  test("gemini sends x-goog-api-key and keeps the key out of the url", () => {
    const prompt = buildQuizPrompt({
      cues,
      startMs: 0,
      endMs: 5_000,
      questionCount: 2,
    });
    const request = buildProviderRequest(
      settings({
        provider: "gemini",
        model: "gemini-2.0-flash",
        apiKey: GEMINI_KEY,
        baseUrl: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      }),
      prompt,
    );

    const url = new URL(request.url);
    assert.equal(request.method, "POST");
    assert.equal(url.origin, "https://generativelanguage.googleapis.com");
    assert.equal(url.pathname, "/v1beta/models/gemini-2.0-flash:generateContent");
    assert.equal(url.search, "");
    assert.equal(request.headers["x-goog-api-key"], GEMINI_KEY);
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.url.includes(GEMINI_KEY), false);
    assert.equal(request.url.includes("key="), false);

    const body = JSON.parse(request.body) as {
      contents: { role: string; parts: { text: string }[] }[];
      generationConfig: { responseMimeType: string };
    };
    assert.equal(body.contents[0]?.role, "user");
    assert.equal(body.contents[0]?.parts[0]?.text, prompt);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(request.body.includes(GEMINI_KEY), false);
    assertHeadersStayOutOfUrl(request.url, request.headers, GEMINI_KEY);
  });

  test("does not copy headers onto an openai-compatible url", () => {
    const prompt = "Reply with a JSON object.";
    const request = buildProviderRequest(
      settings({
        provider: "openai-compatible",
        model: "local-model",
        apiKey: OPENAI_KEY,
        baseUrl: `https://models.example/v1?api-version=1&token=${OPENAI_KEY}`,
      }),
      prompt,
    );

    const url = new URL(request.url);
    assert.equal(url.origin, "https://models.example");
    assert.equal(url.pathname, "/v1/chat/completions");
    assert.equal(url.searchParams.get("api-version"), "1");
    assert.equal(url.searchParams.get("token"), null);
    assert.equal(request.headers.Authorization, `Bearer ${OPENAI_KEY}`);
    assert.equal(JSON.parse(request.body).response_format.type, "json_object");
    assert.equal(JSON.parse(request.body).messages[0].content, prompt);
    assertHeadersStayOutOfUrl(request.url, request.headers, OPENAI_KEY);

    const probe = buildTestKeyRequest(
      settings({
        provider: "gemini",
        model: "gemini-2.0-flash",
        apiKey: GEMINI_KEY,
        baseUrl: `https://evil.example/models?key=${GEMINI_KEY}`,
      }),
    );
    assert.equal(probe.method, "GET");
    assert.equal(probe.url, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(probe.headers["x-goog-api-key"], GEMINI_KEY);
    assert.equal(probe.body, "");
    assertHeadersStayOutOfUrl(probe.url, probe.headers, GEMINI_KEY);
  });

  test("a missing key throws before a request exists", () => {
    assert.throws(
      () => buildProviderRequest(settings({ apiKey: "  " }), "ping"),
      (error: unknown) => {
        assert.ok(error instanceof ProviderConfigError);
        assert.equal(error.code, "missing-key");
        assert.equal(error.message, "missing-key");
        return true;
      },
    );
    assert.throws(
      () => buildTestKeyRequest(settings({ apiKey: "" })),
      (error: unknown) => {
        assert.ok(error instanceof ProviderConfigError);
        assert.equal(error.code, "missing-key");
        return true;
      },
    );
  });
});

describe("parseModelQuestions", () => {
  test("reads a bare array or the questions field of a json object", () => {
    assert.deepEqual(parseModelQuestions("[{\"id\":\"q1\"}]"), [{ id: "q1" }]);
    assert.deepEqual(parseModelQuestions("{\"questions\":[{\"id\":\"q2\"}]}"), [{ id: "q2" }]);
    assert.deepEqual(parseModelQuestions("```json\n[{\"id\":\"q3\"}]\n```"), [{ id: "q3" }]);
  });
});

describe("extractModelText", () => {
  test("reads a typical OpenAI chat completion", () => {
    const content = "{\"questions\":[{\"id\":\"q1\"}]}";
    const text = extractModelText({
      id: "chatcmpl-1",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
    });
    assert.equal(text, content);
  });

  test("reads a typical Gemini generateContent body", () => {
    const content = "[{\"id\":\"q1\",\"prompt\":\"What makes energy?\"}]";
    const text = extractModelText({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: content }],
          },
          finishReason: "STOP",
        },
      ],
    });
    assert.equal(text, content);
  });
});
