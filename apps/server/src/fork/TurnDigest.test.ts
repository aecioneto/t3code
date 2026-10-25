import { assert, it } from "@effect/vitest";
import { RunId } from "@t3tools/contracts";

import { buildTurnDigest, hasFileChanges } from "./TurnDigest.ts";

const run = RunId.make("run:1");
const other = RunId.make("run:2");

it("digests only the asked run: messages, commands, changed files and errors", () => {
  const digest = buildTurnDigest({
    runId: run,
    outcome: "completed",
    messages: [
      { runId: run, role: "user", text: "ajuste o login" },
      { runId: run, role: "assistant", text: "rascunho" },
      { runId: run, role: "assistant", text: "pronto" },
      { runId: other, role: "user", text: "outra coisa" },
    ] as never,
    turnItems: [
      { type: "file_change", runId: run, fileName: "a.php", additions: 3, deletions: 1 },
      { type: "file_change", runId: run, fileName: "x", changes: [{ path: "b.php" }] },
      { type: "file_change", runId: other, fileName: "z.php" },
      { type: "command_execution", runId: run, input: "rtk vitest run" },
      { type: "error", runId: run, title: "timeout" },
      { type: "error", runId: run, title: null },
    ] as never,
  });
  assert.deepEqual(digest.userMessages, ["ajuste o login"]);
  assert.equal(digest.assistantFinal, "pronto");
  assert.deepEqual(digest.commands, ["rtk vitest run"]);
  assert.deepEqual(digest.changedFiles, [
    { path: "a.php", additions: 3, deletions: 1 },
    { path: "b.php" },
  ]);
  assert.deepEqual(digest.errors, ["timeout", "provider error"]);
  assert.equal(hasFileChanges(digest), true);
});

it("a read-only run has no file changes", () => {
  const digest = buildTurnDigest({
    runId: run,
    outcome: "completed",
    messages: [] as never,
    turnItems: [{ type: "command_execution", runId: run, input: "ls" }] as never,
  });
  assert.equal(hasFileChanges(digest), false);
  assert.equal(digest.assistantFinal, null);
});
