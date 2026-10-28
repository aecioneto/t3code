import { describe, expect, it } from "vite-plus/test";
import { canExtractSymbols, extractSymbols } from "./symbols.ts";

const names = (language: string, source: string) =>
  extractSymbols(language, source).map(
    (symbol) => `${symbol.kind}:${symbol.parent ? `${symbol.parent}.` : ""}${symbol.name}`,
  );

describe("typescript", () => {
  const source = [
    "import x from 'y';",
    "export interface Options { a: string }",
    "export type Id = string;",
    "export const LIMIT = 5;",
    "export const make = (a: number) => a;",
    "const internal = () => 1;",
    "export function build(input: Options): Id {",
    "  return 'x';",
    "}",
    "export class Service extends Base {",
    "  private cache = 1;",
    "  constructor(private readonly store: Store) {",
    "    super();",
    "  }",
    "  async find(id: Id): Promise<Item> {",
    "    if (id) {",
    "      return this.load(id);",
    "    }",
    "  }",
    "  private load(id: Id) {",
    "  }",
    "}",
    "// export function commented() {}",
  ].join("\n");

  it("finds declarations, class members and skips control flow and comments", () => {
    expect(names("typescript", source)).toEqual([
      "interface:Options",
      "type:Id",
      "const:LIMIT",
      "function:make",
      "function:internal",
      "function:build",
      "class:Service",
      "method:Service.constructor",
      "method:Service.find",
      "method:Service.load",
    ]);
  });

  it("reports line, signature and whether a symbol is exported", () => {
    const symbols = extractSymbols("typescript", source);
    const find = symbols.find((symbol) => symbol.name === "find");
    expect(find).toMatchObject({ line: 15, signature: "async find(id: Id): Promise<Item>" });
    expect(symbols.find((symbol) => symbol.name === "internal")?.exported).toBe(false);
    expect(symbols.find((symbol) => symbol.name === "build")?.exported).toBe(true);
    expect(symbols.find((symbol) => symbol.name === "load")?.exported).toBe(false);
  });
});

describe("php", () => {
  it("finds classes, methods with visibility, and Laravel routes", () => {
    const source = [
      "<?php",
      "namespace App\\Http;",
      "final class UserController extends Controller",
      "{",
      "    public function index(Request $request)",
      "    {",
      "    }",
      "    private function secret() {}",
      "}",
      "Route::get('/users', [UserController::class, 'index']);",
    ].join("\n");
    expect(names("php", source)).toEqual([
      "class:UserController",
      "method:UserController.index",
      "method:UserController.secret",
      "route:GET /users",
    ]);
    expect(extractSymbols("php", source).find((symbol) => symbol.name === "secret")?.exported).toBe(
      false,
    );
  });
});

describe("ruby", () => {
  it("tracks nesting by end and marks private methods", () => {
    const source = [
      "module Billing",
      "  class Invoice < ApplicationRecord",
      "    def total",
      "    end",
      "    def self.overdue",
      "    end",
      "    private",
      "    def rounding",
      "    end",
      "  end",
      "  def helper",
      "  end",
      "end",
    ].join("\n");
    expect(names("ruby", source)).toEqual([
      "module:Billing",
      "class:Billing.Invoice",
      "method:Invoice.total",
      "method:Invoice.overdue",
      "method:Invoice.rounding",
      "method:Billing.helper",
    ]);
    expect(
      extractSymbols("ruby", source).find((symbol) => symbol.name === "rounding")?.exported,
    ).toBe(false);
  });
});

describe("python", () => {
  it("nests methods under their class by indentation", () => {
    const source = [
      "class Repo:",
      "    def get(self, id):",
      "        return id",
      "    async def _load(self):",
      "        pass",
      "def top():",
      "    pass",
    ].join("\n");
    expect(names("python", source)).toEqual([
      "class:Repo",
      "method:Repo.get",
      "method:Repo._load",
      "function:top",
    ]);
  });
});

describe("support", () => {
  it("knows which languages it reads and returns nothing for the rest", () => {
    expect(canExtractSymbols("ruby")).toBe(true);
    expect(canExtractSymbols("rust")).toBe(false);
    expect(canExtractSymbols(null)).toBe(false);
    expect(extractSymbols("rust", "fn main() {}")).toEqual([]);
  });
});
