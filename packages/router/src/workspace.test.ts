import { describe, expect, it } from "vite-plus/test";
import {
  classifyNature,
  DEFAULT_PROTECTED_BRANCHES,
  planWorkspace,
  type WorkspaceInput,
} from "./workspace.ts";

const base: WorkspaceInput = {
  nature: "fix",
  impact: { files: 2, layers: 1, touchesMigrations: false, touchesDeps: false },
  checkout: { branch: "feature/x", dirty: false, busyOverlap: false },
  protectedBranches: DEFAULT_PROTECTED_BRANCHES,
  existingWorktreePath: null,
};
interface PlanPatch {
  readonly nature?: WorkspaceInput["nature"];
  readonly impact?: Partial<WorkspaceInput["impact"]>;
  readonly checkout?: Partial<WorkspaceInput["checkout"]>;
  readonly existingWorktreePath?: string | null;
}
const plan = (patch: PlanPatch) =>
  planWorkspace({
    ...base,
    nature: patch.nature ?? base.nature,
    existingWorktreePath: patch.existingWorktreePath ?? base.existingWorktreePath,
    impact: { ...base.impact, ...patch.impact },
    checkout: { ...base.checkout, ...patch.checkout },
  });

describe("classifyNature", () => {
  it("reads the first intent in the request", () => {
    expect(classifyNature("Adicione login no copiador")).toBe("feature");
    expect(classifyNature("corrija o erro 500 ao salvar")).toBe("fix");
    expect(classifyNature("migre o model para Eloquent")).toBe("migration");
    expect(classifyNature("refatore o controller")).toBe("refactor");
    expect(classifyNature("explique como adicionar login")).toBe("investigation");
    expect(classifyNature("bom dia")).toBe("unknown");
  });
});

describe("planWorkspace", () => {
  it("keeps a read-only question in the current checkout", () => {
    expect(plan({ nature: "investigation", checkout: { dirty: true } }).workspace).toBe("current");
  });

  it("reuses the worktree of a feature in progress", () => {
    const result = plan({ nature: "feature", existingWorktreePath: "/w/login" });
    expect(result).toMatchObject({ workspace: "existing_worktree", worktreePath: "/w/login" });
  });

  it("never edits a protected branch directly", () => {
    expect(plan({ checkout: { branch: "main" } }).workspace).toBe("worktree");
    expect(plan({ checkout: { branch: "release" } }).workspace).toBe("current");
    expect(
      planWorkspace({
        ...base,
        checkout: { ...base.checkout, branch: "release" },
        protectedBranches: ["release"],
      }).workspace,
    ).toBe("worktree");
  });

  it("isolates when the checkout is dirty or another thread overlaps", () => {
    expect(plan({ checkout: { dirty: true } }).workspace).toBe("worktree");
    expect(plan({ checkout: { busyOverlap: true } }).reason).toContain("another running thread");
  });

  it("sends features, migrations and big changes to a worktree", () => {
    expect(plan({ nature: "feature" }).workspace).toBe("worktree");
    expect(plan({ impact: { touchesMigrations: true } }).workspace).toBe("worktree");
    expect(plan({ impact: { touchesDeps: true } }).workspace).toBe("worktree");
    expect(plan({ impact: { layers: 3 } }).workspace).toBe("worktree");
    expect(plan({ impact: { files: 6 } }).workspace).toBe("worktree");
  });

  it("keeps a small fix on the current branch", () => {
    expect(plan({})).toMatchObject({ workspace: "current", ask: false });
  });

  it("asks on the borderline and marks a recommendation", () => {
    const borderline = plan({ impact: { files: 4, layers: 1 } });
    expect(borderline).toMatchObject({ workspace: "current", ask: true });
    expect(plan({ impact: { files: 5, layers: 2 } })).toMatchObject({
      workspace: "worktree",
      ask: true,
    });
    expect(plan({ impact: { files: null } }).ask).toBe(true);
  });
});
