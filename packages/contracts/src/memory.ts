import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";

// Mirrors packages/memory; apps/server tests keep the two lists in step.
export const MemoryKind = Schema.Literals([
  "decision",
  "convention",
  "architecture",
  "command",
  "gotcha",
  "preference",
  "todo",
]);
export type MemoryKind = typeof MemoryKind.Type;

export const MemoryStatus = Schema.Literals(["active", "pending_review", "superseded", "archived"]);
export type MemoryStatus = typeof MemoryStatus.Type;

export const ProjectMemory = Schema.Struct({
  id: Schema.Int,
  projectId: ProjectId,
  kind: MemoryKind,
  title: Schema.String,
  body: Schema.String,
  tags: Schema.Array(Schema.String),
  status: MemoryStatus,
  pinned: Schema.Boolean,
  origin: Schema.Literals(["auto", "agent", "user"]),
  confidence: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  useCount: Schema.Int,
});
export type ProjectMemory = typeof ProjectMemory.Type;

export const MemoryListInput = Schema.Struct({
  projectId: ProjectId,
  kind: Schema.optional(MemoryKind),
  status: Schema.optional(MemoryStatus),
  afterId: Schema.optional(Schema.Int),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type MemoryListInput = typeof MemoryListInput.Type;

export const MemoryListResult = Schema.Struct({
  memories: Schema.Array(ProjectMemory),
  nextCursor: Schema.NullOr(Schema.Int),
});
export type MemoryListResult = typeof MemoryListResult.Type;

export const MemoryCreateInput = Schema.Struct({
  projectId: ProjectId,
  kind: MemoryKind,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  body: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
  tags: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(40)))),
  pinned: Schema.optional(Schema.Boolean),
});
export type MemoryCreateInput = typeof MemoryCreateInput.Type;

export const MemoryUpdateInput = Schema.Struct({
  projectId: ProjectId,
  id: Schema.Int,
  patch: Schema.Struct({
    kind: Schema.optional(MemoryKind),
    title: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
    body: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000))),
    tags: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(40)))),
    pinned: Schema.optional(Schema.Boolean),
    status: Schema.optional(MemoryStatus),
  }),
});
export type MemoryUpdateInput = typeof MemoryUpdateInput.Type;

export const MemoryDeleteInput = Schema.Struct({ projectId: ProjectId, id: Schema.Int });
export type MemoryDeleteInput = typeof MemoryDeleteInput.Type;

export class MemoryError extends Schema.TaggedError<MemoryError>()("MemoryError", {
  operation: Schema.Literals(["list", "create", "update", "delete"]),
  /** Set when the request was refused for a reason the user can act on. */
  reason: Schema.optional(Schema.Literals(["disabled", "secret", "too_long", "not_found"])),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "Memory is off for this project. Turn it on in Settings > Beta.";
      case "secret":
        return "This looks like a credential, so it was not saved.";
      case "too_long":
        return "The title or body is too long.";
      case "not_found":
        return "That memory does not exist in this project.";
      case undefined:
        return `Memory ${this.operation} failed.`;
    }
  }
}
