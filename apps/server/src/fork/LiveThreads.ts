import type { OrchestrationV2ThreadShell, ProjectId, ThreadId } from "@t3tools/contracts";
import type { LiveThread } from "@t3tools/router/threads";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

const MAX_THREADS = 6;
const MAX_RECENT_MESSAGES = 3;
const MAX_RECENT_CHARS = 600;
const MAX_TOUCHED_FILES = 200;

export interface ProjectLiveThread extends LiveThread {
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

export class LiveThreads extends Context.Service<
  LiveThreads,
  {
    /** The project's open threads, newest first. Reads only; a thread's data is kept until it changes. */
    readonly forProject: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<ProjectLiveThread>>;
  }
>()("t3/fork/LiveThreads") {}

const isOpen = (shell: OrchestrationV2ThreadShell) =>
  shell.deletedAt === null &&
  shell.archivedAt === null &&
  shell.lineage.relationshipToParent !== "subagent";

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  // A thread's detail is rebuilt only when its shell changed, so typing does not rescan history.
  const cache = new Map<
    ThreadId,
    { readonly updatedAt: number; readonly value: ProjectLiveThread }
  >();

  const describe = Effect.fn("LiveThreads.describe")(function* (shell: OrchestrationV2ThreadShell) {
    const updatedAt = DateTime.toEpochMillis(shell.updatedAt);
    const cached = cache.get(shell.id);
    if (cached !== undefined && cached.updatedAt === updatedAt) return cached.value;
    const records = yield* threads.getThreadRecords(shell.id, [
      "providerTurns",
      "messages",
      "turnItems",
    ]);
    const latestUsage = records.providerTurns
      .flatMap((turn) => (turn.tokenUsage === undefined ? [] : [turn.tokenUsage]))
      .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    const touched = new Set<string>();
    for (const item of records.turnItems) {
      if (item.type !== "file_change") continue;
      for (const change of item.changes ?? [{ path: item.fileName }]) touched.add(change.path);
      if (touched.size >= MAX_TOUCHED_FILES) break;
    }
    const value: ProjectLiveThread = {
      id: shell.id,
      title: shell.title,
      recentText: records.messages
        .slice(-MAX_RECENT_MESSAGES)
        .map((message) => message.text)
        .join(" ")
        .slice(0, MAX_RECENT_CHARS),
      touchedFiles: Array.from(touched),
      status:
        shell.pendingRuntimeRequest !== null
          ? "waiting_approval"
          : shell.activeRunId !== null
            ? "running"
            : "idle",
      usedTokens: latestUsage?.usedTokens ?? null,
      maxTokens: latestUsage?.maxTokens ?? null,
      lastActivityAt: updatedAt,
      branch: shell.branch,
      worktreePath: shell.worktreePath,
    };
    cache.set(shell.id, { updatedAt, value });
    return value;
  });

  const forProject = Effect.fn("LiveThreads.forProject")(function* (projectId: ProjectId) {
    const snapshot = yield* threads
      .getShellSnapshot({ location: "active" })
      .pipe(Effect.orElseSucceed(() => undefined));
    if (snapshot === undefined) return [];
    const open = snapshot.threads
      .filter((shell) => shell.projectId === projectId && isOpen(shell))
      .toSorted(
        (left, right) =>
          DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
      )
      .slice(0, MAX_THREADS);
    const described = yield* Effect.forEach(open, (shell) => describe(shell).pipe(Effect.option));
    return described.flatMap((entry) => (entry._tag === "Some" ? [entry.value] : []));
  });

  return LiveThreads.of({ forProject });
});

export const layer = Layer.effect(LiveThreads, make);
