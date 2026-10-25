import type {
  RouterCandidate,
  RouterClassifyResult,
  RouterWorkspacePlan,
} from "@t3tools/contracts";

export const ROUTER_MIN_PROMPT_CHARS = 12;

/** The chip only suggests a switch; it never fires when the draft's project already leads. */
export function pickRouterSuggestion(
  result: RouterClassifyResult,
  activeProjectId: string | null,
): RouterCandidate | null {
  if (result.mode === "ask") return null;
  const top = result.candidates[0];
  if (top === undefined || top.projectId === activeProjectId) return null;
  return top;
}

export interface WorkspaceSuggestion {
  readonly envMode: "local" | "worktree";
  readonly reason: string;
  readonly ask: boolean;
  /** What the router saw, kept so a recorded choice can be read later without the prompt. */
  readonly nature: string;
  readonly filesEstimate: number | null;
  readonly layers: number;
}

/** Only a different environment than the draft's is worth saying; an existing worktree is not offered here. */
export function pickWorkspaceSuggestion(
  result: RouterWorkspacePlan,
  currentEnvMode: "local" | "worktree",
): WorkspaceSuggestion | null {
  if (result.plan.workspace === "existing_worktree") return null;
  const envMode = result.plan.workspace === "worktree" ? "worktree" : "local";
  if (envMode === currentEnvMode) return null;
  return {
    envMode,
    reason: result.plan.reason,
    ask: result.plan.ask,
    nature: result.nature,
    filesEstimate: result.impact.files,
    layers: result.impact.layers,
  };
}
