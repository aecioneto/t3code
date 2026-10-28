// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import * as MemoryMirror from "./MemoryMirror.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";

const projectId = ProjectId.make("p1");

const layerFor = (root: string, enabled = true) =>
  MemoryMirror.layer.pipe(
    Layer.provideMerge(MemoryService.layer),
    Layer.provideMerge(MemoryStore.layer),
    Layer.provideMerge(ForkDatabase.layerMemory),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome({ workspaceRoot: root } as never),
        }),
        ServerSettings.layerTest({ memoryEnabledProjectIds: enabled ? ["p1"] : [] }).pipe(
          Layer.orDie,
        ),
        NodeServices.layer,
      ),
    ),
    Layer.orDie,
  );

const root = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-mirror-"));

it.effect(
  "writes active notes into AGENTS.md without touching the rest, and rewrites in place",
  () => {
    const dir = root();
    const file = NodePath.join(dir, "AGENTS.md");
    NodeFS.writeFileSync(file, "# Regras do time\n\nNão mexa aqui.\n");
    return Effect.gen(function* () {
      const store = yield* MemoryStore.MemoryStore;
      const mirror = yield* MemoryMirror.MemoryMirror;
      const base = { projectId: "p1", origin: "user" } as const;
      yield* store.create({ ...base, kind: "convention", title: "Prefixo", body: "Use rtk" });
      yield* store.create({
        ...base,
        kind: "gotcha",
        title: "Rascunho",
        body: "ainda não",
        status: "pending_review",
      });
      assert.deepEqual(yield* mirror.mirrorProject({ projectId }), { path: "AGENTS.md", notes: 1 });
      const first = NodeFS.readFileSync(file, "utf8");
      assert.ok(first.startsWith("# Regras do time\n\nNão mexa aqui.\n"));
      assert.ok(first.includes("- **Prefixo**: Use rtk"));
      assert.ok(!first.includes("Rascunho"));
      yield* store.create({ ...base, kind: "command", title: "Testes", body: "rtk vitest run" });
      yield* mirror.mirrorProject({ projectId });
      const second = NodeFS.readFileSync(file, "utf8");
      assert.equal(second.match(/t3:memory:start/g)?.length, 1);
      assert.ok(second.includes("- **Testes**: rtk vitest run"));
    }).pipe(Effect.provide(layerFor(dir)));
  },
);

it.effect("does nothing while memory is off for the project", () => {
  const dir = root();
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      (yield* MemoryMirror.MemoryMirror).mirrorProject({ projectId }),
    );
    assert.equal(error.reason, "disabled");
    assert.equal(NodeFS.existsSync(NodePath.join(dir, "AGENTS.md")), false);
  }).pipe(Effect.provide(layerFor(dir, false)));
});
