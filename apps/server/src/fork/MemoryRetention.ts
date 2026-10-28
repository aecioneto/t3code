import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as MemoryStore from "./MemoryStore.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_DAYS = 180;
export const PURGE_ARCHIVED_AFTER_DAYS = 90;

/**
 * Notes nobody uses fade out in two steps so a wrong guess can be undone: first they are
 * archived, which the panel can restore, and only later deleted. Notes the user wrote or
 * pinned, and conventions, decisions and architecture, never expire.
 */
export const sweepMemories = Effect.fn("MemoryRetention.sweep")(function* () {
  const store = yield* MemoryStore.MemoryStore;
  const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
  const before = (days: number) => DateTime.formatIso(DateTime.makeUnsafe(nowMs - days * DAY_MS));
  const archived = yield* store.archiveStale({ untouchedSince: before(STALE_AFTER_DAYS) });
  const purged = yield* store.purgeArchived({ archivedBefore: before(PURGE_ARCHIVED_AFTER_DAYS) });
  return { archived, purged };
});

export const layer = Layer.effectDiscard(
  sweepMemories().pipe(
    Effect.catchCause((cause) => Effect.logWarning("Failed to retire stale notes.", { cause })),
  ),
);
