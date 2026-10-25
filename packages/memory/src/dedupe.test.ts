import { describe, expect, it } from "vite-plus/test";
import { decideDedupe, jaccard, type KnownMemory } from "./dedupe.ts";

const known: ReadonlyArray<KnownMemory> = [
  {
    id: 1,
    kind: "command",
    title: "Rodar os testes",
    body: "Use rtk vitest run para rodar os testes",
  },
  { id: 2, kind: "gotcha", title: "Cache do Rails", body: "Limpar tmp/cache ao trocar de branch" },
];

describe("decideDedupe", () => {
  it("skips a note that is the same fact, ignoring case and accents", () => {
    expect(
      decideDedupe(
        { kind: "gotcha", title: "cache do rails", body: "limpar TMP/cache ao trocar de branch" },
        known,
      ),
    ).toEqual({ action: "skip", id: 2 });
  });

  it("skips a near-identical body", () => {
    expect(
      decideDedupe(
        { kind: "command", title: "Testes", body: "Use rtk vitest run para rodar os testes agora" },
        known,
      ),
    ).toEqual({ action: "skip", id: 1 });
  });

  it("supersedes when the subject repeats but the statement changed", () => {
    expect(
      decideDedupe(
        {
          kind: "gotcha",
          title: "Cache do Rails",
          body: "Nunca limpe o cache; use o bundle exec spring stop",
        },
        known,
      ),
    ).toEqual({ action: "supersede", id: 2 });
  });

  it("merges a fuller wording of the same fact", () => {
    const result = decideDedupe(
      {
        kind: "command",
        title: "Rodar os testes",
        body: "Use rtk vitest run para rodar os testes do pacote e depois rtk lint",
      },
      known,
    );
    expect(result).toMatchObject({ action: "merge", id: 1 });
    expect(result.action === "merge" && result.body).toContain("rtk lint");
  });

  it("only compares notes of the same kind", () => {
    expect(
      decideDedupe(
        { kind: "decision", title: "Cache do Rails", body: "Limpar tmp/cache ao trocar de branch" },
        known,
      ),
    ).toEqual({ action: "create" });
  });

  it("creates when nothing is close", () => {
    expect(
      decideDedupe(
        { kind: "gotcha", title: "Fila travada", body: "Reinicie o worker quando a fila travar" },
        known,
      ),
    ).toEqual({ action: "create" });
  });
});

describe("jaccard", () => {
  it("is 1 for equal word sets and 0 for disjoint ones", () => {
    expect(jaccard("a b c", "c b a")).toBe(1);
    expect(jaccard("alfa beta", "gama delta")).toBe(0);
  });
});
