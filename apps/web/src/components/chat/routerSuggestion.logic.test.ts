import type { RouterClassifyResult, RouterWorkspacePlan } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pickRouterSuggestion, pickWorkspaceSuggestion } from "./routerSuggestion.logic";

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

const planOf = (
  workspace: RouterWorkspacePlan["plan"]["workspace"],
  ask = false,
): RouterWorkspacePlan => ({
  nature: "feature",
  impact: { files: 3, layers: 1, touchesMigrations: false, touchesDeps: false },
  branch: "main",
  dirty: false,
  plan: { workspace, reason: "a new feature", ask, confidence: 0.85 },
  thread: { action: "new", reason: "the project has no live thread" },
});

describe("pickWorkspaceSuggestion", () => {
  it("suggests a worktree when the draft would work in place", () => {
    expect(pickWorkspaceSuggestion(planOf("worktree"), "local")).toEqual({
      envMode: "worktree",
      reason: "a new feature",
      ask: false,
      nature: "feature",
      filesEstimate: 3,
      layers: 1,
    });
  });

  it("stays quiet when the draft already matches or an existing worktree is implied", () => {
    expect(pickWorkspaceSuggestion(planOf("worktree"), "worktree")).toBeNull();
    expect(pickWorkspaceSuggestion(planOf("current"), "local")).toBeNull();
    expect(pickWorkspaceSuggestion(planOf("existing_worktree"), "local")).toBeNull();
  });

  it("keeps the borderline flag so the chip can say it is a toss-up", () => {
    expect(pickWorkspaceSuggestion(planOf("current", true), "worktree")?.ask).toBe(true);
  });
});
