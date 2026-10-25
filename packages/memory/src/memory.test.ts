import { describe, expect, it } from "vite-plus/test";
import { contentHash, toFtsQuery } from "./memory.ts";

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
