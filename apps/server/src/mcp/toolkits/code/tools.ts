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

export const CodeToolkit = Toolkit.make(CodeMapTool);
