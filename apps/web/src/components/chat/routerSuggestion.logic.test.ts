import type { RouterClassifyResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pickRouterSuggestion } from "./routerSuggestion.logic";

const result = (
  mode: RouterClassifyResult["mode"],
  ...projectIds: ReadonlyArray<string>
): RouterClassifyResult => ({
  mode,
  via: "lexical",
  confidence: 0.6,
  candidates: projectIds.map((projectId) => ({
    projectId,
    slug: projectId,
    name: projectId,
    score: 0.6,
  })),
});

describe("pickRouterSuggestion", () => {
  it("suggests the top candidate when it differs from the draft's project", () => {
    expect(pickRouterSuggestion(result("confirm", "rota", "copiador"), "copiador")?.projectId).toBe(
      "rota",
    );
  });

  it("stays quiet when the draft's project already leads or the router cannot tell", () => {
    expect(pickRouterSuggestion(result("confirm", "rota"), "rota")).toBeNull();
    expect(pickRouterSuggestion(result("ask", "rota"), "copiador")).toBeNull();
    expect(pickRouterSuggestion(result("confirm"), "copiador")).toBeNull();
  });
});
