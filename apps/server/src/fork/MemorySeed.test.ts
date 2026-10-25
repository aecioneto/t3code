// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import * as MemorySeed from "./MemorySeed.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";

const projectId = ProjectId.make("p1");

const workspace = (files: Readonly<Record<string, string>>) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-seed-"));
  for (const [name, content] of Object.entries(files)) {
    NodeFS.writeFileSync(NodePath.join(root, name), content);
  }
  return root;
};

const layerFor = (root: string, enabled = true) =>
  MemorySeed.layer.pipe(
    Layer.provideMerge(MemoryService.layer),
    Layer.provideMerge(MemoryStore.layer),
    Layer.provideMerge(ForkDatabase.layerMemory),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some({ workspaceRoot: root } as never)),
        }),
        ServerSettings.layerTest({ memoryEnabledProjectIds: enabled ? ["p1"] : [] }).pipe(
          Layer.orDie,
        ),
        NodeServices.layer,
      ),
    ),
    Layer.orDie,
  );

const claude = "## Comandos\n- Rode os testes com rtk vitest run antes de commitar\n";
const agents =
  "## Regras\n- Nunca use any em código novo do projeto\n## Comandos\n- Rode os testes com rtk vitest run antes de commitar\n";

it.effect("proposes the list items of both files for review, once", () => {
  const root = workspace({ "CLAUDE.md": claude, "AGENTS.md": agents });
  return Effect.gen(function* () {
    const seed = yield* MemorySeed.MemorySeed;
    const store = yield* MemoryStore.MemoryStore;
    const first = yield* seed.seedProject({ projectId });
    assert.deepEqual(first, { proposed: 2, alreadyKnown: 1, files: ["CLAUDE.md", "AGENTS.md"] });
    const saved = yield* store.list({ projectId, limit: 10 });
    assert.deepEqual(
      saved.map((memory) => [memory.status, memory.origin]),
      [
        ["pending_review", "auto"],
        ["pending_review", "auto"],
      ],
    );
    const again = yield* seed.seedProject({ projectId });
    assert.equal(again.proposed, 0);
  }).pipe(Effect.provide(layerFor(root)));
});

it.effect("needs memory to be on, and a folder without the files proposes nothing", () =>
  Effect.gen(function* () {
    const off = yield* Effect.flip(
      Effect.gen(function* () {
        return yield* (yield* MemorySeed.MemorySeed).seedProject({ projectId });
      }).pipe(Effect.provide(layerFor(workspace({}), false))),
    );
    assert.equal(off.reason, "disabled");
    const empty = yield* Effect.gen(function* () {
      return yield* (yield* MemorySeed.MemorySeed).seedProject({ projectId });
    }).pipe(Effect.provide(layerFor(workspace({}))));
    assert.deepEqual(empty, { proposed: 0, alreadyKnown: 0, files: [] });
  }),
);
