// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as CodeIndexer from "./CodeIndexer.ts";
import * as CodeMapService from "./CodeMapService.ts";
import * as CodeMapStore from "./CodeMapStore.ts";
import * as ForkDatabase from "./ForkDatabase.ts";

const layerFor = (enabled = true) =>
  CodeMapService.layer.pipe(
    Layer.provideMerge(CodeIndexer.layer),
    Layer.provideMerge(CodeMapStore.layer),
    Layer.provideMerge(ForkDatabase.layerMemory),
    Layer.provide(
      Layer.mergeAll(
        VcsProcess.layer,
        ServerSettings.layerTest({ codeMapEnabledProjectIds: enabled ? ["p1"] : [] }).pipe(
          Layer.orDie,
        ),
      ),
    ),
    Layer.provide(NodeServices.layer),
    Layer.orDie,
  );

const makeProject = (files: Readonly<Record<string, string>>, git = false) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-codemap-"));
  for (const [file, content] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, file), content);
  }
  if (git) NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
};

it.effect("maps a folder tree without secrets, binaries or vendored code", () => {
  const root = makeProject({
    "src/app.ts": "export const a = 1;",
    "src/lib/util.ts": "export const b = 2;",
    ".env": "TOKEN=abcdefghijk",
    "node_modules/x/index.js": "x",
    "logo.png": "binary",
    "README.md": "# hi",
  });
  return Effect.gen(function* () {
    const service = yield* CodeMapService.CodeMapService;
    const result = yield* service.rebuild({ projectId: "p1", rootPath: root });
    assert.equal(result.files, 3);
    const view = yield* service.view({ projectId: "p1", rootPath: root });
    assert.equal(view.building, false);
    assert.include(view.map, "src/ (2)");
    assert.include(view.map, "src/lib/ (1): util.ts");
    assert.notInclude(view.map, ".env");
    assert.notInclude(view.map, "node_modules");
    const folder = yield* service.view({ projectId: "p1", rootPath: root, directory: "src/lib" });
    assert.include(folder.map, "./ (1): util.ts");
  }).pipe(Effect.provide(layerFor()));
});

it.effect("respects .gitignore in a git checkout and rescans only what changed", () => {
  const root = makeProject(
    { ".gitignore": "generated/\n", "src/a.ts": "a", "generated/g.ts": "g" },
    true,
  );
  return Effect.gen(function* () {
    const service = yield* CodeMapService.CodeMapService;
    const first = yield* service.rebuild({ projectId: "p1", rootPath: root });
    assert.deepEqual([first.files, first.changed], [2, 2]);
    NodeFS.writeFileSync(NodePath.join(root, "src/a.ts"), "changed");
    NodeFS.writeFileSync(NodePath.join(root, "src/b.ts"), "b");
    const second = yield* service.rebuild({ projectId: "p1", rootPath: root });
    assert.deepEqual([second.files, second.changed, second.removed], [3, 2, 0]);
    NodeFS.rmSync(NodePath.join(root, "src/b.ts"));
    const third = yield* service.rebuild({ projectId: "p1", rootPath: root });
    assert.deepEqual([third.files, third.changed, third.removed], [2, 0, 1]);
    const view = yield* service.view({ projectId: "p1", rootPath: root });
    assert.notInclude(view.map, "generated");
  }).pipe(Effect.provide(layerFor()));
});

it.effect("refreshes only the files a run changed and ignores unscanned checkouts", () => {
  const root = makeProject({ "src/a.ts": "a", "src/b.ts": "b" });
  return Effect.gen(function* () {
    const service = yield* CodeMapService.CodeMapService;
    const checkout = { projectId: "p1", rootPath: root };
    yield* service.refresh({ ...checkout, paths: ["src/a.ts"] });
    assert.equal((yield* service.status(checkout)).files, 0);
    yield* service.rebuild(checkout);
    NodeFS.writeFileSync(NodePath.join(root, "src/c.ts"), "c");
    NodeFS.rmSync(NodePath.join(root, "src/a.ts"));
    yield* service.refresh({ ...checkout, paths: ["src/a.ts", "src/c.ts"] });
    const view = yield* service.view(checkout);
    assert.include(view.map, "src/ (2): b.ts, c.ts");
  }).pipe(Effect.provide(layerFor()));
});

it.effect("starts the first scan in the background and answers building", () => {
  const root = makeProject({ "src/a.ts": "a" });
  return Effect.gen(function* () {
    const service = yield* CodeMapService.CodeMapService;
    const checkout = { projectId: "p1", rootPath: root };
    const first = yield* service.view(checkout);
    assert.deepEqual([first.building, first.map], [true, ""]);
    // The scan lock makes this wait for the background scan before it runs.
    yield* service.rebuild(checkout);
    const ready = yield* service.view(checkout);
    assert.equal(ready.building, false);
    assert.include(ready.map, "src/ (1): a.ts");
  }).pipe(Effect.provide(layerFor()));
});

it.effect("refuses when the map is off or the folder leaves the project", () => {
  const root = makeProject({ "src/a.ts": "a" });
  return Effect.gen(function* () {
    const service = yield* CodeMapService.CodeMapService;
    const off = yield* Effect.flip(service.view({ projectId: "p1", rootPath: root }));
    assert.equal(off._tag, "CodeMapRejectedError");
  }).pipe(
    Effect.provide(layerFor(false)),
    Effect.andThen(
      Effect.gen(function* () {
        const service = yield* CodeMapService.CodeMapService;
        const escape = yield* Effect.flip(
          service.view({ projectId: "p1", rootPath: root, directory: "../secret" }),
        );
        assert.equal(escape._tag, "CodeMapRejectedError");
      }).pipe(Effect.provide(layerFor())),
    ),
  );
});
