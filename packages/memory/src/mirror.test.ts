import { describe, expect, it } from "vite-plus/test";
import { applyMirror, MIRROR_END, MIRROR_START, renderMirror } from "./mirror.ts";

const notes = [
  { kind: "command", title: "Testes", body: "Use rtk vitest run" },
  { kind: "convention", title: "Prefixo", body: "Todo comando começa\ncom rtk" },
  { kind: "gotcha", title: "Chave", body: "Use DB_PASSWORD=hunter2hunter2 só local" },
] as const;

describe("renderMirror", () => {
  it("groups notes by kind between the markers, on one line each, without secrets", () => {
    const block = renderMirror(notes);
    expect(block.startsWith(MIRROR_START)).toBe(true);
    expect(block.endsWith(MIRROR_END)).toBe(true);
    expect(block.indexOf("### Conventions")).toBeLessThan(block.indexOf("### Commands"));
    expect(block).toContain("- **Prefixo**: Todo comando começa com rtk");
    expect(block).not.toContain("hunter2hunter2");
  });
});

describe("applyMirror", () => {
  const block = renderMirror(notes);

  it("creates the file content when there is none", () => {
    expect(applyMirror(null, block)).toBe(`${block}\n`);
  });

  it("appends after existing content, keeping it intact", () => {
    const result = applyMirror("# Regras\n\nTexto do time.\n", block);
    expect(result.startsWith("# Regras\n\nTexto do time.\n\n")).toBe(true);
    expect(result.endsWith(`${block}\n`)).toBe(true);
  });

  it("replaces only the previous block", () => {
    const first = applyMirror(
      "# Antes\n",
      renderMirror([{ kind: "todo", title: "Nota antiga", body: "some depois" }]),
    );
    const second = applyMirror(`${first}\n# Depois\n`, block);
    expect(second.match(/t3:memory:start/g)).toHaveLength(1);
    expect(second).toContain("# Antes");
    expect(second).toContain("# Depois");
    expect(second).not.toContain("Nota antiga");
    expect(second).toContain("### Conventions");
  });
});
