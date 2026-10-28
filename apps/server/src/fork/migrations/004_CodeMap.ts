import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One root per checkout: a worktree is a different set of files than the main folder.
  yield* sql`
    CREATE TABLE code_roots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      root_path TEXT NOT NULL,
      indexed_at TEXT,
      UNIQUE (project_id, root_path)
    )
  `;
  yield* sql`
    CREATE TABLE code_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      language TEXT,
      content_hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      indexed_at TEXT NOT NULL,
      UNIQUE (root_id, path)
    )
  `;
  yield* sql`
    CREATE TABLE code_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      parent TEXT,
      line INTEGER NOT NULL,
      signature TEXT,
      exported INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`CREATE INDEX code_symbols_file_idx ON code_symbols(file_id)`;

  // Rows are removed in code, symbols first, so these triggers only mirror inserts and deletes.
  yield* sql`
    CREATE VIRTUAL TABLE code_fts USING fts5(
      name, path,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `;
  yield* sql`
    CREATE TRIGGER code_fts_insert AFTER INSERT ON code_symbols BEGIN
      INSERT INTO code_fts (rowid, name, path)
      VALUES (new.id, new.name, (SELECT path FROM code_files WHERE id = new.file_id));
    END
  `;
  yield* sql`
    CREATE TRIGGER code_fts_delete AFTER DELETE ON code_symbols BEGIN
      DELETE FROM code_fts WHERE rowid = old.id;
    END
  `;
});
