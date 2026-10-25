import type { ProjectProfile } from "@t3tools/router/profile";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

export class RouterStoreError extends Schema.TaggedError<RouterStoreError>()("RouterStoreError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Router store failed during ${this.operation}.`;
  }
}

export interface RoutingFeedback {
  readonly prompt: string;
  readonly suggestedProjectId: string | null;
  readonly chosenProjectId: string;
  readonly createdAt: string;
}

const JsonList = Schema.fromJsonString(Schema.Array(Schema.String));

const ProfileRow = Schema.Struct({
  projectId: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  aliases: JsonList,
  description: Schema.String,
  stack: JsonList,
  keywords: JsonList,
});

export class RouterStore extends Context.Service<
  RouterStore,
  {
    readonly upsertProfile: (profile: ProjectProfile) => Effect.Effect<void, RouterStoreError>;
    readonly listProfiles: () => Effect.Effect<ReadonlyArray<ProjectProfile>, RouterStoreError>;
    readonly recordFeedback: (feedback: RoutingFeedback) => Effect.Effect<void, RouterStoreError>;
    readonly recentFeedback: (input: {
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<RoutingFeedback>, RouterStoreError>;
  }
>()("t3/fork/RouterStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const encodeList = Schema.encodeEffect(JsonList);

  const readProfiles = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProfileRow,
    execute: () => sql`
      SELECT project_id AS "projectId", slug AS "slug", name AS "name",
        aliases_json AS "aliases", description AS "description",
        stack_json AS "stack", keywords_json AS "keywords"
      FROM router_profiles
      ORDER BY slug
    `,
  });
  const readFeedback = SqlSchema.findAll({
    Request: Schema.Struct({ limit: Schema.Int }),
    Result: Schema.Struct({
      prompt: Schema.String,
      suggestedProjectId: Schema.NullOr(Schema.String),
      chosenProjectId: Schema.String,
      createdAt: Schema.String,
    }),
    execute: ({ limit }) => sql`
      SELECT prompt AS "prompt", suggested_project_id AS "suggestedProjectId",
        chosen_project_id AS "chosenProjectId", created_at AS "createdAt"
      FROM routing_feedback
      ORDER BY id DESC
      LIMIT ${limit}
    `,
  });

  const upsertProfile = Effect.fn("RouterStore.upsertProfile")(
    function* (profile: ProjectProfile) {
      const aliases = yield* encodeList(profile.aliases);
      const stack = yield* encodeList(profile.stack);
      const keywords = yield* encodeList(profile.keywords);
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
      INSERT INTO router_profiles (
        project_id, slug, name, aliases_json, description, stack_json, keywords_json, updated_at
      ) VALUES (
        ${profile.id}, ${profile.slug}, ${profile.name}, ${aliases},
        ${profile.description}, ${stack}, ${keywords}, ${updatedAt}
      )
      ON CONFLICT (project_id) DO UPDATE SET
        slug = excluded.slug, name = excluded.name, aliases_json = excluded.aliases_json,
        description = excluded.description, stack_json = excluded.stack_json,
        keywords_json = excluded.keywords_json, updated_at = excluded.updated_at
    `;
    },
    Effect.mapError((cause) => new RouterStoreError({ operation: "upsertProfile", cause })),
  );

  const listProfiles = Effect.fn("RouterStore.listProfiles")(function* () {
    const rows = yield* readProfiles(undefined).pipe(
      Effect.mapError((cause) => new RouterStoreError({ operation: "listProfiles", cause })),
    );
    return rows.map((row): ProjectProfile => ({
      id: row.projectId,
      slug: row.slug,
      name: row.name,
      aliases: row.aliases,
      description: row.description,
      stack: row.stack,
      keywords: row.keywords,
    }));
  });

  const recordFeedback = Effect.fn("RouterStore.recordFeedback")(function* (
    feedback: RoutingFeedback,
  ) {
    yield* sql`
      INSERT INTO routing_feedback (prompt, suggested_project_id, chosen_project_id, created_at)
      VALUES (${feedback.prompt}, ${feedback.suggestedProjectId}, ${feedback.chosenProjectId}, ${feedback.createdAt})
    `.pipe(
      Effect.mapError((cause) => new RouterStoreError({ operation: "recordFeedback", cause })),
    );
  });

  const recentFeedback = Effect.fn("RouterStore.recentFeedback")(function* (input: {
    readonly limit: number;
  }) {
    return yield* readFeedback(input).pipe(
      Effect.mapError((cause) => new RouterStoreError({ operation: "recentFeedback", cause })),
    );
  });

  return RouterStore.of({ upsertProfile, listProfiles, recordFeedback, recentFeedback });
});

export const layer = Layer.effect(RouterStore, make);
