import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as CodeMapService from "../../../fork/CodeMapService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const CodeMapTool = Tool.make("t3_code_map", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    CodeMapService.CodeMapService,
  ],
  description:
    "Outline of this project's folders and files, to find where code lives without grep. Pass `directory` to zoom in. Empty with building=true while the first scan runs; retry shortly.",
  parameters: Schema.Struct({
    directory: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
  }),
  success: Schema.Struct({
    map: Schema.String,
    files: Schema.Int,
    building: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const Symbol = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
  parent: Schema.NullOr(Schema.String),
  line: Schema.Int,
  signature: Schema.String,
});

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    CodeMapService.CodeMapService,
  ],
};

const FindSymbolTool = Tool.make("t3_find_symbol", {
  ...shared,
  description:
    "Find where a class, function, method or route is defined in this project: path and line. Matches the exact name first, then names that start with it.",
  parameters: Schema.Struct({
    name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    kind: Schema.optional(Schema.String.check(Schema.isMaxLength(20))),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
  }),
  success: Schema.Struct({
    symbols: Schema.Array(Schema.Struct({ ...Symbol.fields, path: Schema.String })),
    building: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const FileOutlineTool = Tool.make("t3_file_outline", {
  ...shared,
  description:
    "List the definitions in one file with line numbers and signatures, so you can open only the part you need.",
  parameters: Schema.Struct({
    path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
  }),
  success: Schema.Struct({
    symbols: Schema.Array(Symbol),
    indexed: Schema.Boolean,
    building: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const CodeToolkit = Toolkit.make(CodeMapTool, FindSymbolTool, FileOutlineTool);
