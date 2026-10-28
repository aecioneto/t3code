// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as CodeIndexer from "../../../fork/CodeIndexer.ts";
import * as CodeMapService from "../../../fork/CodeMapService.ts";
import * as CodeMapStore from "../../../fork/CodeMapStore.ts";
import * as ForkDatabase from "../../../fork/ForkDatabase.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as CodeHandlers from "./handlers.ts";
import { CodeToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:code");
const mapped = ProjectId.make("project:code-on");
const unmapped = ProjectId.make("project:code-off");

const makeRoot = (name: string) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `t3-code-tool-${name}-`));
  NodeFS.mkdirSync(NodePath.join(root, "src"));
  NodeFS.writeFileSync(
    NodePath.join(root, "src", `${name}.ts`),
    `export function ${name}Handler(id: string) {\n  return id;\n}\n`,
  );
  return root;
};

const layerFor = (projectId: ProjectId, workspaceRoot: string, worktreePath: string | null) =>
  Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment:code"),
      requestNamespace: "provider:code",
      thread: {
        threadId,
        providerSessionId: "provider:code",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({ ...liveThreadShell(threadId), projectId, worktreePath }),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedSome({ workspaceRoot } as never),
    }),
  );

const services = CodeMapService.layer.pipe(
  Layer.provideMerge(CodeIndexer.layer),
  Layer.provideMerge(CodeMapStore.layer),
  Layer.provideMerge(ForkDatabase.layerMemory),
  Layer.provide(VcsProcess.layer),
  Layer.provide(Settings.layerTest({ codeMapEnabledProjectIds: [mapped] })),
  Layer.provide(NodeServices.layer),
);

const callAs = (
  shared: Layer.Layer<CodeMapService.CodeMapService>,
  projectId: ProjectId,
  workspaceRoot: string,
  worktreePath: string | null,
  params: object,
  name: keyof (typeof CodeToolkit)["tools"] = "t3_code_map",
) =>
  Effect.gen(function* () {
    const toolkit = yield* CodeToolkit;
    const parts = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect);
    return parts.at(-1)?.result as Readonly<Record<string, unknown>>;
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(CodeHandlers.layer).pipe(
        Layer.provideMerge(Layer.merge(layerFor(projectId, workspaceRoot, worktreePath), shared)),
      ),
    ),
  );

it.effect(
  "answers building first, then maps the thread's own worktree rather than the project folder",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(services);
      const shared = Layer.succeedContext(context);
      const main = makeRoot("main");
      const worktree = makeRoot("feature");
      const first = yield* callAs(shared, mapped, main, worktree, {});
      expect(first).toMatchObject({ building: true, map: "" });
      const service = yield* Effect.provide(CodeMapService.CodeMapService, shared);
      // The lock makes this wait for the background scan to finish.
      yield* service.rebuild({ projectId: mapped, rootPath: worktree });
      const ready = yield* callAs(shared, mapped, main, worktree, {});
      expect(ready).toMatchObject({ building: false, files: 1 });
      expect(String(ready.map)).toContain("feature.ts");
      expect(String(ready.map)).not.toContain("main.ts");
    }).pipe(Effect.scoped),
);

it.effect("refuses a project that did not turn the map on", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(services);
    const shared = Layer.succeedContext(context);
    const result = yield* callAs(shared, unmapped, makeRoot("off"), null, {});
    expect(result).toMatchObject({ code: "invalid_request" });
    const escape = yield* callAs(shared, mapped, makeRoot("esc"), null, { directory: "../x" });
    expect(escape).toMatchObject({ code: "invalid_request" });
  }).pipe(Effect.scoped),
);

it.effect("finds a definition and outlines its file for the thread's checkout", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(services);
    const shared = Layer.succeedContext(context);
    const main = makeRoot("lookup");
    const service = yield* Effect.provide(CodeMapService.CodeMapService, shared);
    yield* service.rebuild({ projectId: mapped, rootPath: main });
    const found = yield* callAs(
      shared,
      mapped,
      main,
      null,
      { name: "lookupHandler" },
      "t3_find_symbol",
    );
    expect(found).toMatchObject({
      building: false,
      symbols: [{ name: "lookupHandler", kind: "function", path: "src/lookup.ts", line: 1 }],
    });
    const outline = yield* callAs(
      shared,
      mapped,
      main,
      null,
      { path: "src/lookup.ts" },
      "t3_file_outline",
    );
    expect(outline).toMatchObject({
      indexed: true,
      symbols: [
        { name: "lookupHandler", line: 1, signature: "export function lookupHandler(id: string)" },
      ],
    });
    const missing = yield* callAs(
      shared,
      mapped,
      main,
      null,
      { path: "src/none.ts" },
      "t3_file_outline",
    );
    expect(missing).toMatchObject({ indexed: false, symbols: [] });
    const escape = yield* callAs(
      shared,
      mapped,
      main,
      null,
      { path: "../x.ts" },
      "t3_file_outline",
    );
    expect(escape).toMatchObject({ code: "invalid_request" });
  }).pipe(Effect.scoped),
);
