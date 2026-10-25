import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2TurnItem,
  RunId,
} from "@t3tools/contracts";
import type { TurnDigest } from "@t3tools/memory/extract";

/** One finished run as the extractor sees it: its messages, commands, file changes and errors. */
export function buildTurnDigest(input: {
  readonly runId: RunId;
  readonly outcome: string;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
}): TurnDigest {
  const messages = input.messages.filter((message) => message.runId === input.runId);
  const items = input.turnItems.filter((item) => item.runId === input.runId);
  const changed = new Map<string, { additions?: number; deletions?: number }>();
  const commands: Array<string> = [];
  const errors: Array<string> = [];
  for (const item of items) {
    if (item.type === "file_change") {
      const paths = item.changes?.map((change) => change.path) ?? [item.fileName];
      for (const path of paths) {
        changed.set(path, {
          ...(item.additions === undefined ? {} : { additions: item.additions }),
          ...(item.deletions === undefined ? {} : { deletions: item.deletions }),
        });
      }
    } else if (item.type === "command_execution") {
      commands.push(item.input);
    } else if (item.type === "error") {
      errors.push(item.title ?? "provider error");
    }
  }
  return {
    userMessages: messages
      .filter((message) => message.role === "user")
      .map((message) => message.text),
    assistantFinal: messages.filter((message) => message.role === "assistant").at(-1)?.text ?? null,
    commands,
    changedFiles: Array.from(changed, ([path, stats]) => ({ path, ...stats })),
    errors,
    outcome: input.outcome,
  };
}

export const hasFileChanges = (digest: TurnDigest) => digest.changedFiles.length > 0;
