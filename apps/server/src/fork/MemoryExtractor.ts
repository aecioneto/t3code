import type { RunId, ThreadId } from "@t3tools/contracts";
import { decideDedupe, type KnownMemory } from "@t3tools/memory/dedupe";
import {
  buildExtractionInput,
  EXTRACTION_INSTRUCTIONS,
  parseExtraction,
} from "@t3tools/memory/extract";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";
import * as ModelClient from "./ModelClient.ts";
import { buildTurnDigest, hasFileChanges } from "./TurnDigest.ts";

const MIN_CONFIDENCE = 0.6;
const HIGH_CONFIDENCE = 0.9;
const REVIEW_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
const CALLS_PER_THREAD_PER_HOUR = 4;
const HOUR_MS = 60 * 60 * 1000;
const KNOWN_LIMIT = 200;

export type ExtractionOutcome =
  | { readonly status: "skipped"; readonly reason: string }
  | {
      readonly status: "done";
      readonly created: number;
      readonly merged: number;
      readonly superseded: number;
      readonly duplicates: number;
      readonly queuedForReview: number;
    };

export class MemoryExtractor extends Context.Service<
  MemoryExtractor,
  {
    /** Reads one finished run and saves what is worth keeping. Never edits the run or its files. */
    readonly extractRun: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<ExtractionOutcome>;
  }
>()("t3/fork/MemoryExtractor") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const memory = yield* MemoryService.MemoryService;
  const store = yield* MemoryStore.MemoryStore;
  const model = yield* ModelClient.ModelClient;
  const calls = yield* Ref.make(new Map<string, ReadonlyArray<number>>());

  // A thread that finishes many short runs must not turn into many model calls.
  const withinBudget = Effect.fn("MemoryExtractor.withinBudget")(function* (threadId: string) {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    return yield* Ref.modify(calls, (all) => {
      const recent = (all.get(threadId) ?? []).filter((at) => now - at < HOUR_MS);
      if (recent.length >= CALLS_PER_THREAD_PER_HOUR) return [false, all] as const;
      return [true, new Map(all).set(threadId, [...recent, now])] as const;
    });
  });

  const inReviewPeriod = Effect.fn("MemoryExtractor.inReviewPeriod")(function* (projectId: string) {
    const first = yield* store.firstAutoCreatedAt(projectId);
    if (first === undefined) return true;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    return now - Date.parse(first) < REVIEW_PERIOD_MS;
  });

  const run = Effect.fn("MemoryExtractor.run")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) {
    const records = yield* threads.getThreadRecords(input.threadId, ["messages", "turnItems"]);
    const projectId = records.thread.projectId;
    if (!(yield* memory.isEnabled(projectId))) {
      return { status: "skipped", reason: "memory is off for the project" } as const;
    }
    const digest = buildTurnDigest({
      runId: input.runId,
      outcome: "completed",
      messages: records.messages,
      turnItems: records.turnItems,
    });
    if (!hasFileChanges(digest)) {
      return { status: "skipped", reason: "the run changed no files" } as const;
    }
    if (!(yield* withinBudget(input.threadId))) {
      return { status: "skipped", reason: "too many extractions for this thread" } as const;
    }
    const raw = yield* model
      .complete({ system: EXTRACTION_INSTRUCTIONS, prompt: buildExtractionInput(digest) })
      .pipe(Effect.option);
    if (raw._tag === "None") return { status: "skipped", reason: "no model answered" } as const;

    const parsed = parseExtraction(raw.value, MIN_CONFIDENCE);
    const known: Array<KnownMemory> = [
      ...(yield* store.list({ projectId, status: "active", limit: KNOWN_LIMIT })),
      ...(yield* store.list({ projectId, status: "pending_review", limit: KNOWN_LIMIT })),
    ];
    const reviewing = yield* inReviewPeriod(projectId);
    let created = 0;
    let merged = 0;
    let superseded = 0;
    let duplicates = 0;
    let queued = 0;
    for (const candidate of parsed.candidates) {
      const decision = decideDedupe(candidate, known);
      if (decision.action === "skip") {
        duplicates += 1;
        continue;
      }
      if (decision.action === "merge") {
        yield* store.update(decision.id, { body: decision.body });
        merged += 1;
        continue;
      }
      const review =
        candidate.review !== null || reviewing || candidate.confidence < HIGH_CONFIDENCE;
      const saved = yield* store.create({
        projectId,
        kind: candidate.kind,
        title: candidate.title,
        body: candidate.body,
        tags: candidate.tags,
        origin: "auto",
        status: review ? "pending_review" : "active",
        confidence: candidate.confidence,
        sourceThreadId: input.threadId,
        sourceProvider: records.thread.providerInstanceId,
        ...(decision.action === "supersede" ? { supersedesId: decision.id } : {}),
      });
      if (saved.action === "created") {
        known.push(saved.memory);
        if (decision.action === "supersede") superseded += 1;
        else created += 1;
        if (review) queued += 1;
      }
    }
    return {
      status: "done",
      created,
      merged,
      superseded,
      duplicates,
      queuedForReview: queued,
    } as const;
  });

  const extractRun = (input: { readonly threadId: ThreadId; readonly runId: RunId }) =>
    run(input).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Memory extraction failed.", { threadId: input.threadId, cause }).pipe(
          Effect.as({ status: "skipped", reason: "extraction failed" } as const),
        ),
      ),
    );

  return MemoryExtractor.of({ extractRun });
});

export const layer = Layer.effect(MemoryExtractor, make);
