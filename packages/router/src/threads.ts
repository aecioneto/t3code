import { tokenize } from "./profile.ts";

export interface LiveThread {
  readonly id: string;
  readonly title: string;
  /** Text of the last few messages; the topic the thread is about. */
  readonly recentText: string;
  readonly touchedFiles: ReadonlyArray<string>;
  readonly status: "idle" | "running" | "waiting_approval";
  /** `null` when the provider does not report them. */
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
  readonly lastActivityAt: number;
}

export type ThreadChoice =
  | { readonly action: "send"; readonly threadId: string; readonly reason: string }
  | { readonly action: "queue"; readonly threadId: string; readonly reason: string }
  | { readonly action: "new"; readonly reason: string }
  | { readonly action: "new_with_handoff"; readonly threadId: string; readonly reason: string };

export interface ThreadChoiceConfig {
  readonly coherenceThreshold: number;
  readonly contextLimit: number;
  readonly staleAfterMs: number;
}

export const DEFAULT_THREAD_CHOICE_CONFIG: ThreadChoiceConfig = {
  coherenceThreshold: 0.4,
  contextLimit: 0.6,
  staleAfterMs: 14 * 24 * 60 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_DAYS = 7;
const TOPIC_WEIGHT = 0.5;
const FILE_WEIGHT = 0.35;
const RECENCY_WEIGHT = 0.15;

function topicCoverage(prompt: string, thread: LiveThread): number {
  const wanted = new Set(tokenize(prompt));
  if (wanted.size === 0) return 0;
  const have = new Set(tokenize(`${thread.title} ${thread.recentText}`));
  let hits = 0;
  for (const token of wanted) if (have.has(token)) hits += 1;
  return hits / wanted.size;
}

function fileOverlap(candidateFiles: ReadonlyArray<string>, thread: LiveThread): number {
  if (candidateFiles.length === 0) return 0;
  const touched = new Set(thread.touchedFiles);
  return candidateFiles.filter((file) => touched.has(file)).length / candidateFiles.length;
}

export function threadCoherence(input: {
  readonly prompt: string;
  readonly candidateFiles: ReadonlyArray<string>;
  readonly thread: LiveThread;
  readonly now: number;
}): number {
  const ageDays = Math.max(0, input.now - input.thread.lastActivityAt) / DAY_MS;
  const recency = 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
  return (
    TOPIC_WEIGHT * topicCoverage(input.prompt, input.thread) +
    FILE_WEIGHT * fileOverlap(input.candidateFiles, input.thread) +
    RECENCY_WEIGHT * recency
  );
}

/** Table 4.3: reuse the coherent live thread, queue behind a busy one, start fresh when it is full or stale. */
export function chooseThread(input: {
  readonly prompt: string;
  readonly candidateFiles: ReadonlyArray<string>;
  readonly threads: ReadonlyArray<LiveThread>;
  readonly now: number;
  readonly config?: ThreadChoiceConfig;
}): ThreadChoice {
  const config = input.config ?? DEFAULT_THREAD_CHOICE_CONFIG;
  const live = input.threads.filter(
    (thread) =>
      thread.status !== "idle" || input.now - thread.lastActivityAt <= config.staleAfterMs,
  );
  const best = live
    .map((thread) => ({ thread, score: threadCoherence({ ...input, thread }) }))
    .toSorted((left, right) => right.score - left.score)[0];
  if (best === undefined) {
    return { action: "new", reason: "the project has no live thread" };
  }
  if (best.score < config.coherenceThreshold) {
    return { action: "new", reason: "the topic changed from what the open threads are about" };
  }
  const { thread } = best;
  if (
    thread.usedTokens !== null &&
    thread.maxTokens !== null &&
    thread.maxTokens > 0 &&
    thread.usedTokens / thread.maxTokens > config.contextLimit
  ) {
    return {
      action: "new_with_handoff",
      threadId: thread.id,
      reason: "the thread's context is more than 60% full",
    };
  }
  if (thread.status !== "idle") {
    return { action: "queue", threadId: thread.id, reason: "the thread is busy; this goes next" };
  }
  return { action: "send", threadId: thread.id, reason: "an idle thread already covers this" };
}
