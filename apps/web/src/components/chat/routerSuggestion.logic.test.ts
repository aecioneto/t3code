import type { RouterClassifyResult, RouterWorkspacePlan } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  pickRouterSuggestion,
  pickThreadSuggestion,
  pickWorkspaceSuggestion,
} from "./routerSuggestion.logic";

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

describe("pickThreadSuggestion", () => {
  const withThread = (thread: RouterWorkspacePlan["thread"]): RouterWorkspacePlan => ({
    ...planOf("current"),
    thread,
  });

  it("offers an existing thread to send to or queue behind", () => {
    expect(
      pickThreadSuggestion(withThread({ action: "send", threadId: "t1", reason: "idle" })),
    ).toEqual({ action: "send", threadId: "t1", reason: "idle" });
    expect(
      pickThreadSuggestion(withThread({ action: "queue", threadId: "t1", reason: "busy" }))?.action,
    ).toBe("queue");
  });

  it("names a full thread so the fresh start has a visible reason", () => {
    expect(
      pickThreadSuggestion(
        withThread({ action: "new_with_handoff", threadId: "t1", reason: "context is full" }),
      )?.action,
    ).toBe("new_with_handoff");
  });

  it("offers nothing when there is no thread to name", () => {
    expect(pickThreadSuggestion(withThread({ action: "new", reason: "none" }))).toBeNull();
  });
});
