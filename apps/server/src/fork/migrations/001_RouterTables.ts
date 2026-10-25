import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE router_profiles (
      project_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      description TEXT NOT NULL,
      stack_json TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE routing_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      suggested_project_id TEXT,
      chosen_project_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX routing_feedback_chosen_idx ON routing_feedback(chosen_project_id)`;
});
