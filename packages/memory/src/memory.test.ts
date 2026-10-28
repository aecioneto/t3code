import { describe, expect, it } from "vite-plus/test";
import { contentHash, looksLikeSecret, rankFactor, toFtsQuery } from "./memory.ts";

describe("contentHash", () => {
  it("ignores case, accents and spacing but not kind", () => {
    const base = { kind: "convention", title: "Usar Ação", body: "sempre  usar rtk" } as const;
    expect(contentHash(base)).toBe(
      contentHash({ ...base, title: "usar acao", body: "Sempre usar RTK" }),
    );
    expect(contentHash(base)).not.toBe(contentHash({ ...base, kind: "gotcha" }));
  });
});

describe("toFtsQuery", () => {
  it("quotes every term so operators in user text stay literal", () => {
    expect(toFtsQuery('deploy* OR "migrations"')).toBe('"deploy" OR "migrations"');
  });

  it("drops generic words so topic words decide the match", () => {
    expect(toFtsQuery("show current forks of the clinica-sistema project")).toBe(
      '"show" OR "current" OR "forks" OR "clinica" OR "sistema" OR "project"',
    );
    expect(toFtsQuery("what is the")).toBeNull();
    expect(toFtsQuery("show the new list")).toBe('"show" OR "new" OR "list"');
  });

  it("keeps words the user marks as real terms", () => {
    expect(toFtsQuery("how to do it")).toBeNull();
    expect(toFtsQuery("how to do it", ["Do"])).toBe('"do"');
  });

  it("returns null when nothing searchable remains", () => {
    expect(toFtsQuery(" - ! ")).toBeNull();
  });
});

describe("looksLikeSecret", () => {
  it("flags credentials and keys", () => {
    expect(looksLikeSecret("DB_PASSWORD=hunter2hunter2")).toBe(true);
    expect(looksLikeSecret("use sk-abcdefghijklmnopqrstuvwxyz123456 aqui")).toBe(true);
    expect(looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });

  it("lets ordinary guidance through", () => {
    expect(looksLikeSecret("Rodar migrations antes do deploy; o token expira em 1h")).toBe(false);
    expect(looksLikeSecret("password reset usa o mailer padrão")).toBe(false);
  });
});

describe("rankFactor", () => {
  const nowMs = Date.parse("2026-10-28T00:00:00.000Z");
  const base = {
    pinned: false,
    useCount: 0,
    lastUsedAt: null,
    updatedAt: "2025-01-01T00:00:00.000Z",
    nowMs,
  };

  it("rewards use, recency and pinning without leaving its bounds", () => {
    const stale = rankFactor(base);
    expect(stale).toBeCloseTo(1, 1);
    expect(rankFactor({ ...base, useCount: 5 })).toBeGreaterThan(stale);
    expect(rankFactor({ ...base, updatedAt: "2026-10-27T00:00:00.000Z" })).toBeGreaterThan(stale);
    expect(rankFactor({ ...base, pinned: true })).toBeGreaterThan(stale);
    const most = rankFactor({
      pinned: true,
      useCount: 10_000,
      lastUsedAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z",
      nowMs,
    });
    expect(most).toBeLessThanOrEqual(1.5);
  });
});
