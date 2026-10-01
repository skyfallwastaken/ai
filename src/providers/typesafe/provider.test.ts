import { describe, expect, test } from "bun:test";

import { JEV_MODEL } from "./provider";

describe("typesafe provider", () => {
  test("JEV_MODEL accepts only the Jev family", () => {
    expect(JEV_MODEL.test("jev-latest")).toBe(true);
    expect(JEV_MODEL.test("jev")).toBe(true);
    expect(JEV_MODEL.test("gpt-4")).toBe(false);
  });
});
