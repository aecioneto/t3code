import type { ProjectProfile } from "./profile.ts";
import { route, type RouterThresholds } from "./route.ts";

export interface GoldenEntry {
  readonly prompt: string;
  readonly project: string;
  readonly synthetic?: boolean;
}

export interface GoldenReport {
  readonly labeled: number;
  readonly top1: number;
  readonly top3: number;
  readonly abstained: number;
  readonly unlabeled: number;
  readonly unlabeledAsked: number;
  readonly modes: Readonly<Record<"auto" | "confirm" | "ask", number>>;
  readonly misses: ReadonlyArray<{
    readonly prompt: string;
    readonly expected: string;
    readonly got: string;
  }>;
}

export function evaluateGolden(
  entries: ReadonlyArray<GoldenEntry>,
  profiles: ReadonlyArray<ProjectProfile>,
  thresholds?: RouterThresholds,
  options: { readonly noProjectLabels?: ReadonlyArray<string> } = {},
): GoldenReport {
  const slugs = new Set(profiles.map((profile) => profile.slug));
  const noProject = new Set(options.noProjectLabels ?? []);
  const modes = { auto: 0, confirm: 0, ask: 0 };
  const misses: Array<{ prompt: string; expected: string; got: string }> = [];
  let labeled = 0;
  let top1 = 0;
  let top3 = 0;
  let abstained = 0;
  let unlabeled = 0;
  let unlabeledAsked = 0;
  for (const entry of entries) {
    const decision = route(entry.prompt, profiles, thresholds);
    if (noProject.has(entry.project)) {
      unlabeled += 1;
      if (decision.mode === "ask") unlabeledAsked += 1;
      continue;
    }
    if (!slugs.has(entry.project)) continue;
    labeled += 1;
    modes[decision.mode] += 1;
    const ranked = decision.candidates.map((candidate) => candidate.profile.slug);
    if (ranked.length === 0) abstained += 1;
    if (ranked[0] === entry.project) top1 += 1;
    else misses.push({ prompt: entry.prompt, expected: entry.project, got: ranked[0] ?? "-" });
    if (ranked.slice(0, 3).includes(entry.project)) top3 += 1;
  }
  return { labeled, top1, top3, abstained, unlabeled, unlabeledAsked, modes, misses };
}
