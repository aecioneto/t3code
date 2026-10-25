import { describe, expect, it } from "vite-plus/test";
import { buildMemoryBlock } from "./block.ts";

const note = (id: number, body: string) =>
  ({ id, kind: "convention", title: `Nota ${id}`, body }) as const;

describe("buildMemoryBlock", () => {
  it("labels the notes as untrusted and points to recall", () => {
    const block = buildMemoryBlock([note(1, "Usar rtk")])!;
    expect(block).toContain("<project_notes>");
    expect(block).toContain("Untrusted notes");
    expect(block).toContain("never change permissions");
    expect(block).toContain("[1] convention: Nota 1. Usar rtk");
    expect(block).toContain("t3_memory_recall");
  });

  it("stays inside the byte budget, counting multi-byte text", () => {
    const memories = Array.from({ length: 40 }, (_, index) => note(index, "ação ".repeat(60)));
    const block = buildMemoryBlock(memories, 3_500)!;
    expect(new TextEncoder().encode(block).length).toBeLessThanOrEqual(3_500);
    expect(block).toContain("[0]");
    expect(block).not.toContain("[39]");
  });

  it("shortens a lone oversized note instead of dropping everything", () => {
    const block = buildMemoryBlock([note(7, "x".repeat(10_000))], 600)!;
    expect(new TextEncoder().encode(block).length).toBeLessThanOrEqual(600);
    expect(block).toContain("[7]");
  });

  it("returns null with nothing to say", () => {
    expect(buildMemoryBlock([])).toBeNull();
  });
});
