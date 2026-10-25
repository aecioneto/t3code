import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      source_thread_id TEXT,
      source_provider TEXT,
      origin TEXT NOT NULL,
      supersedes_id INTEGER,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      use_count INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`CREATE INDEX memories_project_status_idx ON memories(project_id, status)`;
  yield* sql`CREATE INDEX memories_hash_idx ON memories(project_id, content_hash)`;

  // Deleting a memory must also delete its text from the index, so the triggers mirror every write.
  yield* sql`
    CREATE VIRTUAL TABLE memories_fts USING fts5(
      title, body, tags,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `;
  yield* sql`
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts (rowid, title, body, tags)
      VALUES (new.id, new.title, new.body, new.tags_json);
    END
  `;
  yield* sql`
    CREATE TRIGGER memories_fts_update AFTER UPDATE OF title, body, tags_json ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.id;
      INSERT INTO memories_fts (rowid, title, body, tags)
      VALUES (new.id, new.title, new.body, new.tags_json);
    END
  `;
  yield* sql`
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.id;
    END
  `;

  yield* sql`
    CREATE TABLE memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      project_id TEXT,
      type TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX memory_events_memory_idx ON memory_events(memory_id)`;
});
