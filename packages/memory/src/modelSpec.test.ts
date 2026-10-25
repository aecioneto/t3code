import { describe, expect, it } from "vite-plus/test";
import { parseModelSpec } from "./modelSpec.ts";

describe("parseModelSpec", () => {
  it("reads the claude and ollama forms", () => {
    expect(parseModelSpec("claude-haiku")).toEqual({ kind: "claude-cli", model: "haiku" });
    expect(parseModelSpec("ollama:qwen2.5:7b")).toEqual({ kind: "ollama", model: "qwen2.5:7b" });
  });

  it("treats anything else, including incomplete forms, as off", () => {
    for (const value of ["off", "lexical-only", "", "claude-", "ollama:", "gpt-4"]) {
      expect(parseModelSpec(value)).toEqual({ kind: "off" });
    }
  });
});
