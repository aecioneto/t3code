import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as CodeMapStore from "./CodeMapStore.ts";
import * as ForkDatabase from "./ForkDatabase.ts";

const layer = CodeMapStore.layer.pipe(Layer.provideMerge(ForkDatabase.layerMemory));

const root = { projectId: "p1", rootPath: "/work/p1" };
const file = (path: string, contentHash: string) => ({
  path,
  language: "typescript",
  contentHash,
  size: 10,
});

it.effect("stores a scan, then applies only what changed", () =>
  Effect.gen(function* () {
    const store = yield* CodeMapStore.CodeMapStore;
    assert.equal(yield* store.status(root), undefined);
    yield* store.apply({
      ...root,
      upserts: [file("a.ts", "h1"), file("b.ts", "h2")],
      deletes: [],
    });
    assert.deepEqual(
      [...(yield* store.hashes(root))],
      [
        ["a.ts", "h1"],
        ["b.ts", "h2"],
      ],
    );
    yield* store.apply({ ...root, upserts: [file("a.ts", "h3")], deletes: ["b.ts"] });
    assert.deepEqual([...(yield* store.hashes(root))], [["a.ts", "h3"]]);
    assert.equal((yield* store.status(root))?.files, 1);
    assert.deepEqual(yield* store.files(root), [{ path: "a.ts", language: "typescript" }]);
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps each checkout of a project separate", () =>
  Effect.gen(function* () {
    const store = yield* CodeMapStore.CodeMapStore;
    const worktree = { projectId: "p1", rootPath: "/work/p1-wt" };
    yield* store.apply({ ...root, upserts: [file("main.ts", "h1")], deletes: [] });
    yield* store.apply({ ...worktree, upserts: [file("feature.ts", "h2")], deletes: [] });
    assert.deepEqual(
      (yield* store.files(root)).map((entry) => entry.path),
      ["main.ts"],
    );
    assert.deepEqual(
      (yield* store.files(worktree)).map((entry) => entry.path),
      ["feature.ts"],
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("forgetting a project removes its files and symbols from the index", () =>
  Effect.gen(function* () {
    const store = yield* CodeMapStore.CodeMapStore;
    const sql = yield* SqlClient.SqlClient;
    yield* store.apply({ ...root, upserts: [file("a.ts", "h1")], deletes: [] });
    yield* sql`
      INSERT INTO code_symbols (file_id, name, kind, line)
      SELECT id, 'UserService', 'class', 1 FROM code_files
    `;
    const before = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM code_fts`;
    assert.equal(before[0]?.count, 1);
    assert.equal(yield* store.forgetProject("p1"), 1);
    const after = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM code_fts`;
    assert.equal(after[0]?.count, 0);
    assert.deepEqual(yield* store.projectIds(), []);
  }).pipe(Effect.provide(layer)),
);
