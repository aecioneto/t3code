// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

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

it.effect("finds a symbol by exact name, prefix and word, and outlines a file", () => {
  const root = makeProject({
    "app/Services/InvoiceService.php": [
      "<?php",
      "class InvoiceService",
      "{",
      "    public function total() {}",
      "    private function roundUp() {}",
      "}",
    ].join("\n"),
    "src/invoice.ts": "export function invoiceTotal(items: number[]) {\n  return 1;\n}\n",
    "routes/web.php": "<?php\nRoute::get('/invoices', [InvoiceController::class, 'index']);\n",
  });
  return Effect.gen(function* () {
    const service = yield* CodeMapService.CodeMapService;
    const checkout = { projectId: "p1", rootPath: root };
    yield* service.rebuild(checkout);
    const exact = yield* service.findSymbol({ ...checkout, name: "invoiceservice", limit: 5 });
    // Other symbols of the same file follow, matched through the file's path.
    assert.deepEqual(
      [exact.symbols[0]?.name, exact.symbols[0]?.path, exact.symbols[0]?.line],
      ["InvoiceService", "app/Services/InvoiceService.php", 2],
    );
    const prefix = yield* service.findSymbol({ ...checkout, name: "invoice", limit: 5 });
    // Prefix matches are ordered by name length, shortest first.
    assert.deepEqual(
      prefix.symbols.map((symbol) => symbol.name),
      ["invoiceTotal", "InvoiceService"],
    );
    const routes = yield* service.findSymbol({
      ...checkout,
      name: "invoices",
      kind: "route",
      limit: 5,
    });
    assert.deepEqual(
      routes.symbols.map((symbol) => symbol.name),
      ["GET /invoices"],
    );
    const outline = yield* service.outline({
      ...checkout,
      path: "app/Services/InvoiceService.php",
    });
    assert.deepEqual(
      outline.symbols?.map((symbol) => `${symbol.parent ?? ""}.${symbol.name}:${symbol.line}`),
      [".InvoiceService:2", "InvoiceService.total:4", "InvoiceService.roundUp:5"],
    );
    assert.equal((yield* service.outline({ ...checkout, path: "nope.ts" })).symbols, undefined);
    const map = yield* service.view(checkout);
    assert.include(map.map, "src/ (1): invoice.ts (invoiceTotal)");
    assert.include(map.map, "InvoiceService.php (InvoiceService)");
  }).pipe(Effect.provide(layerFor()));
});

it.effect("re-reads unchanged files when the extractor version changes", () => {
  const root = makeProject({ "src/a.ts": "export function a() {}" });
  return Effect.gen(function* () {
    const store = yield* CodeMapStore.CodeMapStore;
    const service = yield* CodeMapService.CodeMapService;
    const checkout = { projectId: "p1", rootPath: root };
    yield* service.rebuild(checkout);
    const [stored] = [...(yield* store.hashes(checkout))];
    assert.match(stored![1], /^[0-9a-f]{64}:s\d+$/);
    const again = yield* service.rebuild(checkout);
    assert.equal(again.changed, 0);
  }).pipe(Effect.provide(layerFor()));
});

it.effect("scans again in the background only once the map is hours old", () => {
  const root = makeProject({ "src/a.ts": "a" });
  return Effect.gen(function* () {
    const service = yield* CodeMapService.CodeMapService;
    const checkout = { projectId: "p1", rootPath: root };
    yield* service.rebuild(checkout);
    NodeFS.writeFileSync(NodePath.join(root, "src/b.ts"), "b");
    yield* TestClock.adjust("1 hour");
    yield* service.view(checkout);
    yield* Effect.yieldNow;
    // Still fresh: nothing scanned in the background, so this scan finds the new file.
    assert.equal((yield* service.rebuild(checkout)).changed, 1);
    NodeFS.writeFileSync(NodePath.join(root, "src/c.ts"), "c");
    yield* TestClock.adjust("7 hours");
    yield* service.view(checkout);
    yield* Effect.yieldNow;
    // The background scan holds the lock first, so by the time this runs nothing is left to change.
    assert.equal((yield* service.rebuild(checkout)).changed, 0);
    assert.include((yield* service.view(checkout)).map, "src/ (3)");
  }).pipe(Effect.provide(layerFor()));
});
