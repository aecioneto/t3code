import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as MemoryService from "./MemoryService.ts";

/** Codex takes untrusted context as its own entry; every other driver gets the notes ahead of the prompt. */
const CONTEXT_ENTRY_DRIVER = "codex";
const CONTEXT_ENTRY_KEY = "t3_project_notes";

/** Notes go in once per native thread: the first provider turn, which a provider switch restarts. */
export const memoryNotesFor = Effect.fn("MemoryInjection.notesFor")(function* (input: {
  readonly memory: Option.Option<MemoryService.MemoryService["Service"]>;
  readonly projectId: string;
  readonly prompt: string;
  readonly providerTurnOrdinal: number;
}) {
  if (input.providerTurnOrdinal !== 1) return null;
  if (Option.isNone(input.memory)) return null;
  return yield* input.memory.value
    .contextBlock({ projectId: input.projectId, prompt: input.prompt })
    .pipe(Effect.orElseSucceed(() => null));
});

export function withMemoryNotes<Message extends { readonly text: string }>(input: {
  readonly driver: string;
  readonly message: Message;
  readonly notes: string | null;
}): {
  readonly message: Message;
  readonly appContext: ReadonlyArray<{ readonly key: string; readonly text: string }>;
} {
  if (input.notes === null) return { message: input.message, appContext: [] };
  if (input.driver === CONTEXT_ENTRY_DRIVER) {
    return {
      message: input.message,
      appContext: [{ key: CONTEXT_ENTRY_KEY, text: input.notes }],
    };
  }
  // A leading slash is a native command and must stay first.
  if (input.message.text.trimStart().startsWith("/")) {
    return { message: input.message, appContext: [] };
  }
  return {
    message: { ...input.message, text: `${input.notes}\n\n${input.message.text}` },
    appContext: [],
  };
}
