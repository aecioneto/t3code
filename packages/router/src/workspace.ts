import { normalize } from "./profile.ts";

export type RequestNature =
  | "feature"
  | "refactor"
  | "migration"
  | "fix"
  | "investigation"
  | "unknown";

const NATURE_KEYWORDS: ReadonlyArray<readonly [RequestNature, ReadonlyArray<string>]> = [
  ["migration", ["migre", "migrar", "migracao", "migration", "upgrade", "atualize a versao"]],
  ["refactor", ["refatore", "refatorar", "refactor", "reorganize", "renomeie", "simplifique"]],
  [
    "feature",
    [
      "adicione",
      "adicionar",
      "crie",
      "criar",
      "implemente",
      "implementar",
      "nova funcionalidade",
      "add ",
      "create ",
      "implement",
      "build ",
    ],
  ],
  [
    "fix",
    ["corrija", "corrigir", "conserte", "consertar", "erro", "bug", "ajuste", "ajustar", "fix "],
  ],
  [
    "investigation",
    [
      "explique",
      "explicar",
      "como funciona",
      "por que",
      "o que e",
      "investigue",
      "analise",
      "revise",
      "explain",
      "why ",
      "how does",
      "review ",
    ],
  ],
];

/** The earliest keyword decides, so "explique como adicionar login" reads as a question. */
export function classifyNature(prompt: string): RequestNature {
  const text = ` ${normalize(prompt)}`;
  let best: { readonly nature: RequestNature; readonly at: number } | undefined;
  for (const [nature, words] of NATURE_KEYWORDS) {
    for (const word of words) {
      const at = text.indexOf(word.startsWith(" ") ? word : ` ${word}`);
      const found = at === -1 ? text.indexOf(word) : at;
      if (found !== -1 && (best === undefined || found < best.at)) best = { nature, at: found };
    }
  }
  return best?.nature ?? "unknown";
}

export interface WorkspaceImpact {
  /** `null` when the files could not be estimated. */
  readonly files: number | null;
  readonly layers: number;
  readonly touchesMigrations: boolean;
  readonly touchesDeps: boolean;
}

export interface WorkspaceInput {
  readonly nature: RequestNature;
  readonly impact: WorkspaceImpact;
  readonly checkout: {
    readonly branch: string | null;
    readonly dirty: boolean;
    /** Another busy thread is touching the same candidate files. */
    readonly busyOverlap: boolean;
  };
  readonly protectedBranches: ReadonlyArray<string>;
  /** The request continues a feature that already has a worktree. */
  readonly existingWorktreePath: string | null;
}

export interface WorkspacePlan {
  readonly workspace: "current" | "worktree" | "existing_worktree";
  readonly reason: string;
  /** The call is too close to make; the recommendation is shown but the user decides. */
  readonly ask: boolean;
  readonly confidence: number;
  readonly worktreePath?: string;
}

export const DEFAULT_PROTECTED_BRANCHES: ReadonlyArray<string> = ["main", "master", "develop"];

const MAX_SMALL_FILES = 3;
const MAX_MEDIUM_FILES = 5;
const MIN_BIG_LAYERS = 3;

export function planWorkspace(input: WorkspaceInput): WorkspacePlan {
  const { nature, impact, checkout } = input;
  if (nature === "investigation") {
    return { workspace: "current", reason: "read-only question", ask: false, confidence: 0.9 };
  }
  if (input.existingWorktreePath !== null) {
    return {
      workspace: "existing_worktree",
      reason: "continues a feature that already has a worktree",
      ask: false,
      confidence: 0.9,
      worktreePath: input.existingWorktreePath,
    };
  }
  if (checkout.branch !== null && input.protectedBranches.includes(checkout.branch)) {
    return {
      workspace: "worktree",
      reason: `${checkout.branch} is protected and this changes code`,
      ask: false,
      confidence: 0.9,
    };
  }
  if (checkout.dirty || checkout.busyOverlap) {
    return {
      workspace: "worktree",
      reason: checkout.dirty
        ? "the checkout has uncommitted changes"
        : "another running thread touches the same files",
      ask: false,
      confidence: 0.9,
    };
  }
  if (
    nature === "feature" ||
    nature === "migration" ||
    nature === "refactor" ||
    impact.touchesMigrations ||
    impact.touchesDeps ||
    impact.layers >= MIN_BIG_LAYERS ||
    (impact.files !== null && impact.files > MAX_MEDIUM_FILES)
  ) {
    return {
      workspace: "worktree",
      reason:
        nature === "feature"
          ? "a new feature"
          : nature === "migration" || impact.touchesMigrations
            ? "touches migrations"
            : nature === "refactor"
              ? "a refactor"
              : impact.touchesDeps
                ? "changes dependencies"
                : "a large change",
      ask: false,
      confidence: 0.85,
    };
  }
  if (
    nature === "fix" &&
    impact.files !== null &&
    impact.files <= MAX_SMALL_FILES &&
    impact.layers <= 1
  ) {
    return { workspace: "current", reason: "a small fix", ask: false, confidence: 0.85 };
  }
  const recommended = impact.layers >= 2 ? "worktree" : "current";
  return {
    workspace: recommended,
    reason:
      impact.files === null ? "the size of the change is unclear" : "the change is borderline",
    ask: true,
    confidence: 0.55,
  };
}
