import { describe, expect, it } from "vite-plus/test";
import { contentHash, looksLikeSecret, toFtsQuery } from "./memory.ts";

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
    expect(toFtsQuery('NOT "a" OR b*')).toBe('"not" OR "or"');
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
