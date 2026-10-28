import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";

export const CodeMapStatusInput = Schema.Struct({ projectId: ProjectId });
export type CodeMapStatusInput = typeof CodeMapStatusInput.Type;

export const CodeMapStatus = Schema.Struct({
  enabled: Schema.Boolean,
  /** Files in the project folder's index; zero before the first scan. */
  files: Schema.Int,
  indexedAt: Schema.NullOr(Schema.String),
  building: Schema.Boolean,
});
export type CodeMapStatus = typeof CodeMapStatus.Type;

export const CodeMapRebuildInput = Schema.Struct({ projectId: ProjectId });
export type CodeMapRebuildInput = typeof CodeMapRebuildInput.Type;

export const CodeMapRebuildResult = Schema.Struct({
  files: Schema.Int,
  changed: Schema.Int,
  removed: Schema.Int,
});
export type CodeMapRebuildResult = typeof CodeMapRebuildResult.Type;

export class CodeMapError extends Schema.TaggedError<CodeMapError>()("CodeMapError", {
  operation: Schema.Literals(["status", "rebuild"]),
  /** Set when the request was refused for a reason the user can act on. */
  reason: Schema.optional(Schema.Literals(["disabled", "project_not_found"])),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "The code map is off for this project. Turn it on in Settings > Labs.";
      case "project_not_found":
        return "The project was not found.";
      case undefined:
        return `Code map ${this.operation} failed.`;
    }
  }
}
