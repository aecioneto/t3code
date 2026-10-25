import { describe, expect, it } from "vite-plus/test";
import { impactTerms, summarizeImpact } from "./impact.ts";

describe("impactTerms", () => {
  it("prefers identifiers, then long words, and skips request verbs", () => {
    expect(impactTerms("adicione login_attempts no AuthController e ajuste a tela")).toEqual([
      "login_attempts",
      "AuthController",
    ]);
    expect(impactTerms("corrija o relatório de faturamento")).toEqual(["faturamento", "relatorio"]);
  });

  it("returns nothing for a request with no searchable word", () => {
    expect(impactTerms("faça isso")).toEqual([]);
  });
});

describe("summarizeImpact", () => {
  it("counts files and distinct layers from the matched paths", () => {
    const impact = summarizeImpact({
      prompt: "ajuste o login",
      paths: [
        "app/Http/Controllers/LoginController.php",
        "resources/views/login.blade.php",
        "tests/LoginTest.php",
        "tests/LoginTest.php",
      ],
    });
    expect(impact).toMatchObject({ files: 3, layers: 3, touchesMigrations: false });
  });

  it("flags migrations from the wording or the paths, and dependencies from the wording", () => {
    expect(
      summarizeImpact({ prompt: "crie a tabela de clientes", paths: [] }).touchesMigrations,
    ).toBe(true);
    expect(
      summarizeImpact({ prompt: "x", paths: ["database/migrations/2026_create_users.php"] })
        .touchesMigrations,
    ).toBe(true);
    expect(summarizeImpact({ prompt: "instale a biblioteca de PDF", paths: [] }).touchesDeps).toBe(
      true,
    );
  });

  it("keeps the size unknown when the search could not run", () => {
    expect(summarizeImpact({ prompt: "ajuste o login", paths: null }).files).toBeNull();
  });
});
