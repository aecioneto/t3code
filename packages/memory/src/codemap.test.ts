import { describe, expect, it } from "vite-plus/test";
import {
  buildCodeMapBlock,
  isSafeRelativePath,
  languageFor,
  pathsInsideRoot,
  renderCodeMap,
  shouldIndex,
} from "./codemap.ts";

describe("shouldIndex", () => {
  it("skips secrets, lockfiles, binaries, vendored code and large files", () => {
    expect(shouldIndex("src/app.ts", 100)).toBe(true);
    expect(shouldIndex(".env.local", 10)).toBe(false);
    expect(shouldIndex("config/server.pem", 10)).toBe(false);
    expect(shouldIndex("pnpm-lock.yaml", 10)).toBe(false);
    expect(shouldIndex("assets/logo.png", 10)).toBe(false);
    expect(shouldIndex("web/node_modules/x/index.js", 10)).toBe(false);
    expect(shouldIndex("src/big.ts", 600 * 1024)).toBe(false);
  });
});

describe("paths", () => {
  it("knows the language and refuses paths that leave the root", () => {
    expect(languageFor("app/Models/User.php")).toBe("php");
    expect(languageFor("README")).toBeNull();
    expect(isSafeRelativePath("src/a.ts")).toBe(true);
    expect(isSafeRelativePath("../a.ts")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("a//b.ts")).toBe(false);
  });
});

describe("renderCodeMap", () => {
  const files = [
    "README.md",
    "apps/server/src/a.ts",
    "apps/server/src/b.ts",
    "apps/web/src/c.tsx",
    "packages/memory/src/d.ts",
  ].map((path) => ({ path, language: languageFor(path) }));

  it("lists folders with their file counts and names", () => {
    const text = renderCodeMap({ files, budgetTokens: 1000 });
    expect(text).toContain("./ (5): README.md");
    expect(text).toContain("apps/server/src/ (2): a.ts, b.ts");
  });

  it("is deterministic regardless of input order", () => {
    const shuffled = [...files].toReversed();
    expect(renderCodeMap({ files: shuffled, budgetTokens: 1000 })).toBe(
      renderCodeMap({ files, budgetTokens: 1000 }),
    );
  });

  it("gets shallower to fit the budget and puts focused files first", () => {
    const wide = Array.from({ length: 40 }, (_, index) => ({
      path: `src/module${index}/file.ts`,
      language: "typescript",
    }));
    const text = renderCodeMap({ files: wide, budgetTokens: 60 });
    expect(text.length).toBeLessThanOrEqual(60 * 4);
    const focused = renderCodeMap({
      files: [...files, { path: "apps/server/src/z.ts", language: "typescript" }],
      budgetTokens: 1000,
      focusPaths: ["apps/server/src/z.ts"],
    });
    expect(focused).toContain("apps/server/src/ (3): z.ts, a.ts, b.ts");
  });

  it("shows a file's main symbols while they fit, and drops them before dropping files", () => {
    const withSymbols = [
      { path: "src/a.ts", language: "typescript", symbols: ["Alpha", "alphaHelper"] },
      { path: "src/b.ts", language: "typescript", symbols: ["Beta", "b"] },
      { path: "src/.hidden", language: null },
    ];
    // "b" repeats the file name, and the dotfile is counted but not named.
    expect(renderCodeMap({ files: withSymbols, budgetTokens: 1000 })).toContain(
      "src/ (3): a.ts (Alpha, alphaHelper), b.ts (Beta)",
    );
    const tight = renderCodeMap({ files: withSymbols, budgetTokens: 22 });
    expect(tight).not.toContain("Alpha");
    expect(tight.length).toBeLessThanOrEqual(22 * 4);
  });

  it("is empty for a project with no files", () => {
    expect(renderCodeMap({ files: [], budgetTokens: 100 })).toBe("");
  });
});

describe("buildCodeMapBlock", () => {
  it("frames the map as untrusted context and skips an empty one", () => {
    const block = buildCodeMapBlock("./ (1): a.ts");
    expect(block?.startsWith("<project_code_map>")).toBe(true);
    expect(block).toContain("t3_find_symbol");
    expect(block?.endsWith("</project_code_map>")).toBe(true);
    expect(buildCodeMapBlock("  ")).toBeNull();
  });
});

describe("pathsInsideRoot", () => {
  it("makes absolute paths relative and drops anything outside the root", () => {
    expect(
      pathsInsideRoot("/work/app", [
        "/work/app/src/a.ts",
        "src/b.ts",
        "./src/c.ts",
        "/etc/passwd",
        "/work/app2/x.ts",
        "../escape.ts",
        "src/a.ts",
      ]),
    ).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });
});
