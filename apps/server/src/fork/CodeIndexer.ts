// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  isSafeRelativePath,
  languageFor,
  MAX_INDEXED_FILES,
  shouldIndex,
} from "@t3tools/memory/codemap";
import { canExtractSymbols, extractSymbols } from "@t3tools/memory/symbols";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as CodeMapStore from "./CodeMapStore.ts";

const BATCH_SIZE = 200;
// Stored with each hash so a better extractor re-reads files whose bytes did not change.
const EXTRACTOR_VERSION = "s1";
const WALK_SKIPPED = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".git",
  ".next",
  "target",
]);

export class CodeIndexError extends Schema.TaggedError<CodeIndexError>()("CodeIndexError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "The project files could not be indexed.";
  }
}

export interface CodeIndexResult {
  readonly files: number;
  readonly changed: number;
  readonly removed: number;
}

export class CodeIndexer extends Context.Service<
  CodeIndexer,
  {
    /**
     * Scans one checkout and stores what changed. With `paths`, only those files are looked at
     * and nothing else is removed, which is how a finished run refreshes its own changes.
     */
    readonly index: (input: {
      readonly projectId: string;
      readonly rootPath: string;
      readonly paths?: ReadonlyArray<string>;
    }) => Effect.Effect<CodeIndexResult, CodeIndexError>;
  }
>()("t3/fork/CodeIndexer") {}

async function walk(root: string): Promise<ReadonlyArray<string>> {
  const found: Array<string> = [];
  const visit = async (relative: string): Promise<void> => {
    if (found.length >= MAX_INDEXED_FILES) return;
    const entries = await NodeFSP.readdir(NodePath.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const next = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!WALK_SKIPPED.has(entry.name)) await visit(next);
      } else if (entry.isFile()) {
        found.push(next);
      }
    }
  };
  await visit("");
  return found;
}

const make = Effect.gen(function* () {
  const store = yield* CodeMapStore.CodeMapStore;
  const vcs = yield* VcsProcess.VcsProcess;
  // One scan at a time; a second request waits instead of racing the first on the same rows.
  const lock = yield* Semaphore.make(1);

  const listPaths = Effect.fn("CodeIndexer.listPaths")(function* (rootPath: string) {
    const git = yield* vcs
      .run({
        operation: "CodeIndexer.listPaths",
        command: "git",
        args: ["-c", "core.fsmonitor=false", "ls-files", "-co", "--exclude-standard", "-z"],
        cwd: rootPath,
        allowNonZeroExit: true,
        timeoutMs: 15_000,
        maxOutputBytes: 16 * 1024 * 1024,
      })
      .pipe(Effect.orElseSucceed(() => undefined));
    if (git !== undefined && git.exitCode === 0) {
      return git.stdout.split("\0").filter((entry) => entry.length > 0);
    }
    return yield* Effect.tryPromise({
      try: () => walk(rootPath),
      catch: (cause) => new CodeIndexError({ cause }),
    });
  });

  // `null` when the file is gone, unreadable, not a regular file, or not worth mapping.
  const inspect = (rootPath: string, relative: string) =>
    Effect.promise(async () => {
      const absolute = NodePath.join(rootPath, relative);
      try {
        const info = await NodeFSP.lstat(absolute);
        if (!info.isFile() || !shouldIndex(relative, info.size)) return null;
        const bytes = await NodeFSP.readFile(absolute);
        const language = languageFor(relative);
        return {
          path: relative,
          language,
          contentHash: `${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}:${EXTRACTOR_VERSION}`,
          size: info.size,
          symbols: canExtractSymbols(language)
            ? extractSymbols(language, bytes.toString("utf8"))
            : [],
        } satisfies CodeMapStore.IndexedFile;
      } catch {
        return null;
      }
    });

  const run = Effect.fn("CodeIndexer.index")(function* (input: {
    readonly projectId: string;
    readonly rootPath: string;
    readonly paths?: ReadonlyArray<string>;
  }) {
    const known = yield* store.hashes(input);
    const candidates = (input.paths ?? (yield* listPaths(input.rootPath)))
      .filter(isSafeRelativePath)
      .slice(0, MAX_INDEXED_FILES);
    const upserts: Array<CodeMapStore.IndexedFile> = [];
    const present = new Set<string>();
    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE);
      const inspected = yield* Effect.forEach(batch, (path) => inspect(input.rootPath, path), {
        concurrency: 16,
      });
      for (const file of inspected) {
        if (file === null) continue;
        present.add(file.path);
        if (known.get(file.path) !== file.contentHash) upserts.push(file);
      }
      yield* Effect.yieldNow;
    }
    const deletes =
      input.paths === undefined
        ? [...known.keys()].filter((path) => !present.has(path))
        : input.paths.filter((path) => known.has(path) && !present.has(path));
    yield* store.apply({ ...input, upserts, deletes });
    return {
      files:
        input.paths === undefined
          ? present.size
          : known.size - deletes.length + upserts.filter((file) => !known.has(file.path)).length,
      changed: upserts.length,
      removed: deletes.length,
    } satisfies CodeIndexResult;
  });

  const index = Effect.fn("CodeIndexer.index")(function* (input: Parameters<typeof run>[0]) {
    return yield* lock
      .withPermits(1)(run(input))
      .pipe(Effect.mapError((cause) => new CodeIndexError({ cause })));
  });

  return CodeIndexer.of({ index });
});

export const layer = Layer.effect(CodeIndexer, make);
