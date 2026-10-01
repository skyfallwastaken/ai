import { describe, expect, test } from "bun:test";

import { systemOneTokens } from "./systemone";

describe("system one usage", () => {
  test("systemOneTokens reads usage and defaults missing output tokens to zero", () => {
    expect(systemOneTokens({ usage: { input_tokens: 1_000, output_tokens: 20 } })).toEqual({
      inputTokens: 1_000,
      outputTokens: 20,
    });
    expect(systemOneTokens({ usage: { input_tokens: 5 } })).toEqual({ inputTokens: 5, outputTokens: 0 });
  });

  test("systemOneTokens is null without usable input tokens", () => {
    expect(systemOneTokens({})).toBeNull();
    expect(systemOneTokens({ usage: null })).toBeNull();
    expect(systemOneTokens({ usage: { input_tokens: -1 } })).toBeNull();
    expect(systemOneTokens({ usage: { input_tokens: 1.5 } })).toBeNull();
  });
});
