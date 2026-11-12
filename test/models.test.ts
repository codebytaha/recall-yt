import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeSettings } from "../src/shared/models.ts";
import { providerLabel } from "../src/shared/progress.ts";

describe("saved models", () => {
  test("an older single provider becomes one named model", () => {
    const settings = normalizeSettings({
      provider: "openai-compatible",
      model: "llama-3",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "gsk-test",
      intervalMinutes: 10,
      questionsPerStop: 4,
    });

    assert.equal(settings.models.length, 1);
    assert.equal(settings.provider, "openai-compatible");
    assert.equal(settings.model, "llama-3");
    assert.equal(settings.apiKey, "gsk-test");
    assert.equal(settings.name, "api.groq.com");
    assert.equal(providerLabel(settings), "api.groq.com");
  });

  test("the selected model is the one Recall calls, and a saved name wins", () => {
    const settings = normalizeSettings({
      activeModelId: "groq",
      models: [
        {
          id: "openai",
          name: "Work OpenAI",
          provider: "openai",
          model: "gpt-4.1-mini",
          baseUrl: "",
          apiKey: "sk-work",
        },
        {
          id: "groq",
          name: "Groq",
          provider: "openai-compatible",
          model: "llama-3",
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: "gsk-test",
        },
      ],
    });

    assert.equal(settings.activeModelId, "groq");
    assert.equal(settings.provider, "openai-compatible");
    assert.equal(settings.apiKey, "gsk-test");
    assert.equal(providerLabel(settings), "Groq");
  });
});
