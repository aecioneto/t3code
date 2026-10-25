import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE workspace_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      nature TEXT NOT NULL,
      files_estimate INTEGER,
      layers INTEGER NOT NULL,
      suggested TEXT NOT NULL,
      chosen TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX workspace_feedback_project_idx ON workspace_feedback(project_id)`;
});
