import { describe, expect, it } from "vite-plus/test";
import type { ProjectProfile } from "./profile.ts";
import { DEFAULT_THRESHOLDS, detectMention, route } from "./route.ts";

const profile = (
  slug: string,
  description: string,
  extra: Partial<ProjectProfile> = {},
): ProjectProfile => ({
  id: slug,
  slug,
  name: slug,
  aliases: [],
  description,
  stack: [],
  keywords: [],
  ...extra,
});

const profiles = [
  profile("copiador", "Copiador de ordens MT5 para copy trading", {
    keywords: ["MT5", "hedge", "slippage"],
  }),
  profile("rota", "Gestão de licitações e empenhos de órgãos públicos", { aliases: ["licitação"] }),
  profile("spfc", "Dados históricos do São Paulo Futebol Clube", {
    keywords: ["jogadores", "campeonatos"],
  }),
];

describe("detectMention", () => {
  it("resolves @slug, 'no projeto X' and 'X:' prefixes", () => {
    expect(detectMention("corrija isso @rota agora", profiles)?.slug).toBe("rota");
    expect(detectMention("no projeto copiador ajuste o lote", profiles)?.slug).toBe("copiador");
    expect(detectMention("spfc: adicione a página", profiles)?.slug).toBe("spfc");
  });

  it("ignores partial slug matches", () => {
    expect(detectMention("ajuste o rotativo do menu", profiles)).toBeUndefined();
    expect(detectMention("fale com @rotaabc", profiles)).toBeUndefined();
  });
});

describe("route", () => {
  it("treats an explicit mention as full confidence", () => {
    const decision = route("@rota crie relatório", profiles, {
      ...DEFAULT_THRESHOLDS,
      autoStart: true,
    });
    expect(decision).toMatchObject({ via: "mention", mode: "auto", confidence: 1 });
    expect(decision.candidates[0]?.profile.slug).toBe("rota");
  });

  it("asks for confirmation instead of starting while autoStart is off", () => {
    expect(route("@rota crie relatório", profiles).mode).toBe("confirm");
  });

  it("ranks the matching project first on lexical evidence", () => {
    const decision = route("o slippage da ordem MT5 está alto no copy trading", profiles);
    expect(decision.via).toBe("lexical");
    expect(decision.candidates[0]?.profile.slug).toBe("copiador");
  });

  it("asks when no term matches any profile", () => {
    const decision = route("explique o que é um monad", profiles);
    expect(decision).toMatchObject({ mode: "ask", confidence: 0, candidates: [] });
  });

  it("never reaches the auto band when the top two candidates are close", () => {
    const close = [
      profile("a", "laravel relatório faturamento"),
      profile("b", "laravel relatório faturamento clientes"),
    ];
    const decision = route("laravel relatório faturamento", close, {
      ...DEFAULT_THRESHOLDS,
      autoStart: true,
    });
    expect(decision.mode).not.toBe("auto");
    expect(decision.confidence).toBeLessThan(DEFAULT_THRESHOLDS.autoThreshold);
  });
});
