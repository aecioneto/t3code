import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const MAX_PROMPT_CHARS = 120_000;

export const RouterClassifyInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMaxLength(MAX_PROMPT_CHARS)),
});
export type RouterClassifyInput = typeof RouterClassifyInput.Type;

export const RouterCandidate = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  score: Schema.Number,
});
export type RouterCandidate = typeof RouterCandidate.Type;

export const RouterClassifyResult = Schema.Struct({
  mode: Schema.Literals(["auto", "confirm", "ask"]),
  via: Schema.Literals(["mention", "lexical"]),
  confidence: Schema.Number,
  candidates: Schema.Array(RouterCandidate),
});
export type RouterClassifyResult = typeof RouterClassifyResult.Type;

export const RouterRecordChoiceInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMaxLength(MAX_PROMPT_CHARS)),
  suggestedProjectId: Schema.NullOr(TrimmedNonEmptyString),
  chosenProjectId: TrimmedNonEmptyString,
});
export type RouterRecordChoiceInput = typeof RouterRecordChoiceInput.Type;

export class RouterError extends Schema.TaggedError<RouterError>()("RouterError", {
  operation: Schema.Literals([
    "classify",
    "recordChoice",
    "planWorkspace",
    "recordWorkspaceChoice",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Router ${this.operation} failed.`;
  }
}

export const RouterPlanWorkspaceInput = Schema.Struct({
  projectId: ProjectId,
  prompt: Schema.String.check(Schema.isMaxLength(MAX_PROMPT_CHARS)),
});
export type RouterPlanWorkspaceInput = typeof RouterPlanWorkspaceInput.Type;

export const RouterWorkspacePlan = Schema.Struct({
  nature: Schema.Literals(["feature", "refactor", "migration", "fix", "investigation", "unknown"]),
  impact: Schema.Struct({
    files: Schema.NullOr(Schema.Int),
    layers: Schema.Int,
    touchesMigrations: Schema.Boolean,
    touchesDeps: Schema.Boolean,
  }),
  branch: Schema.NullOr(Schema.String),
  dirty: Schema.Boolean,
  plan: Schema.Struct({
    workspace: Schema.Literals(["current", "worktree", "existing_worktree"]),
    reason: Schema.String,
    ask: Schema.Boolean,
    confidence: Schema.Number,
    worktreePath: Schema.optional(Schema.String),
  }),
});
export type RouterWorkspacePlan = typeof RouterWorkspacePlan.Type;

export const RouterRecordWorkspaceChoiceInput = Schema.Struct({
  projectId: ProjectId,
  prompt: Schema.String.check(Schema.isMaxLength(MAX_PROMPT_CHARS)),
  nature: Schema.String.check(Schema.isMaxLength(40)),
  filesEstimate: Schema.NullOr(Schema.Int),
  layers: Schema.Int,
  suggested: Schema.Literals(["current", "worktree"]),
  chosen: Schema.Literals(["current", "worktree"]),
});
export type RouterRecordWorkspaceChoiceInput = typeof RouterRecordWorkspaceChoiceInput.Type;
