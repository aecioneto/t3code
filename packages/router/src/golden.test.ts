import { describe, expect, it } from "vite-plus/test";
import { evaluateGolden } from "./golden.ts";
import type { ProjectProfile } from "./profile.ts";

const profiles: ReadonlyArray<ProjectProfile> = [
  {
    id: "a",
    slug: "alpha",
    name: "alpha",
    aliases: [],
    description: "faturamento de clientes",
    stack: [],
    keywords: [],
  },
  {
    id: "b",
    slug: "beta",
    name: "beta",
    aliases: [],
    description: "jogadores e campeonatos",
    stack: [],
    keywords: [],
  },
];

describe("evaluateGolden", () => {
  it("counts top-1 hits and separates no-project prompts", () => {
    const report = evaluateGolden(
      [
        { prompt: "relatório de faturamento", project: "alpha" },
        { prompt: "lista de jogadores", project: "beta" },
        { prompt: "relatório de jogadores", project: "alpha" },
        { prompt: "explique monads", project: "nada" },
        { prompt: "sem rótulo conhecido faturamento", project: "outro" },
      ],
      profiles,
      undefined,
      { noProjectLabels: ["nada"] },
    );
    expect(report).toMatchObject({ labeled: 3, top1: 2, unlabeled: 1, unlabeledAsked: 1 });
    expect(report.misses).toHaveLength(1);
  });
});
