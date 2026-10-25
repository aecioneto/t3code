import { impactTerms, summarizeImpact } from "@t3tools/router/impact";
import { chooseThread, type ThreadChoice } from "@t3tools/router/threads";
import {
  classifyNature,
  DEFAULT_PROTECTED_BRANCHES,
  planWorkspace,
  type RequestNature,
  type WorkspaceImpact,
  type WorkspacePlan,
} from "@t3tools/router/workspace";
import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import * as LiveThreads from "./LiveThreads.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";

export class WorkspacePlanError extends Schema.TaggedError<WorkspacePlanError>()(
  "WorkspacePlanError",
  {
    projectId: Schema.String,
    reason: Schema.Literals(["project-not-found", "project-unavailable"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "project-not-found"
      ? "The project was not found."
      : "The project could not be read.";
  }
}

export interface WorkspacePlanResult {
  readonly nature: RequestNature;
  readonly impact: WorkspaceImpact;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly plan: WorkspacePlan;
  readonly thread: ThreadChoice;
}

const SEARCH_LIMIT_PER_TERM = 100;

export class WorkspacePlanService extends Context.Service<
  WorkspacePlanService,
  {
    /** Reads the project and its checkout; it never edits or starts anything. */
    readonly plan: (input: {
      readonly projectId: ProjectId;
      readonly prompt: string;
    }) => Effect.Effect<WorkspacePlanResult, WorkspacePlanError>;
  }
>()("t3/fork/WorkspacePlanService") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const entries = yield* WorkspaceEntries.WorkspaceEntries;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const liveThreads = yield* LiveThreads.LiveThreads;

  const plan = Effect.fn("WorkspacePlanService.plan")(function* (input: {
    readonly projectId: ProjectId;
    readonly prompt: string;
  }) {
    const found = yield* projects.getById(input.projectId).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspacePlanError({
            projectId: input.projectId,
            reason: "project-unavailable",
            cause,
          }),
      ),
    );
    if (Option.isNone(found)) {
      return yield* new WorkspacePlanError({
        projectId: input.projectId,
        reason: "project-not-found",
      });
    }
    const cwd = found.value.workspaceRoot;
    const nature = classifyNature(input.prompt);

    // A search that cannot run leaves the size unknown instead of guessing it.
    const paths =
      nature === "investigation"
        ? []
        : yield* Effect.forEach(impactTerms(input.prompt), (query) =>
            entries
              .searchContents({
                cwd,
                query,
                limit: SEARCH_LIMIT_PER_TERM,
                caseSensitive: false,
                wholeWord: false,
                useRegex: false,
              })
              .pipe(Effect.map((result) => result.matches.map((match) => match.path))),
          ).pipe(
            Effect.map((lists) => lists.flat()),
            Effect.map((all) => (all.length === 0 ? null : all)),
            Effect.orElseSucceed(() => null),
          );
    const impact = summarizeImpact({ prompt: input.prompt, paths });
    const candidateFiles = Array.from(new Set(paths ?? []));
    const live = yield* liveThreads.forProject(input.projectId);
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const thread = chooseThread({ prompt: input.prompt, candidateFiles, threads: live, now });
    // A busy thread already touching these files makes the shared checkout a bad place to work.
    const busyOverlap = live.some(
      (entry) =>
        entry.status !== "idle" && entry.touchedFiles.some((file) => candidateFiles.includes(file)),
    );
    // A thread this request belongs to that already works in a worktree keeps that worktree.
    const continued =
      thread.action === "send" || thread.action === "queue"
        ? (live.find((entry) => entry.id === thread.threadId)?.worktreePath ?? null)
        : null;

    const status = yield* git
      .statusDetailsLocal(cwd, { includeDivergence: false })
      .pipe(Effect.option);
    const branch = Option.isSome(status) ? status.value.branch : null;
    const dirty = Option.isSome(status) && status.value.hasWorkingTreeChanges;
    const isRepo = Option.isSome(status) && status.value.isRepo;
    const protectedBranches =
      Option.isSome(status) && status.value.isDefaultBranch && branch !== null
        ? [...DEFAULT_PROTECTED_BRANCHES, branch]
        : DEFAULT_PROTECTED_BRANCHES;

    const planned = isRepo
      ? planWorkspace({
          nature,
          impact,
          checkout: { branch, dirty, busyOverlap },
          protectedBranches,
          existingWorktreePath: continued,
        })
      : ({
          workspace: "current",
          reason: "not a git repository",
          ask: false,
          confidence: 0.9,
        } satisfies WorkspacePlan);
    return { nature, impact, branch, dirty, plan: planned, thread };
  });

  return WorkspacePlanService.of({ plan });
});

export const layer = Layer.effect(WorkspacePlanService, make);
