import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

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
  operation: Schema.Literals(["classify", "recordChoice"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Router ${this.operation} failed.`;
  }
}
