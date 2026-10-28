import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import Migration0001 from "./migrations/001_RouterTables.ts";
import Migration0002 from "./migrations/002_Memories.ts";
import Migration0003 from "./migrations/003_WorkspaceFeedback.ts";
import Migration0004 from "./migrations/004_CodeMap.ts";

// Separate file from statev2.sqlite so the fork's tables never ride along with upstream migrations.
const runMigrations = Migrator.make({})({
  loader: Migrator.fromRecord({
    "1_RouterTables": Migration0001,
    "2_Memories": Migration0002,
    "3_WorkspaceFeedback": Migration0003,
    "4_CodeMap": Migration0004,
  }),
});

const layerSetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* runMigrations;
  }),
);

export const layerMemory = Layer.provideMerge(
  layerSetup,
  NodeSqliteClient.layer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    yield* fs.makeDirectory(stateDir, { recursive: true });
    return Layer.provideMerge(
      layerSetup,
      NodeSqliteClient.layer({ filename: path.join(stateDir, "memory.db") }),
    );
  }),
);
