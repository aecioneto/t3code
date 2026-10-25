import type { RouterCandidate, RouterClassifyResult } from "@t3tools/contracts";

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
