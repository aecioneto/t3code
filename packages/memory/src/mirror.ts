import type { MemoryKind } from "./memory.ts";
import { redactSecrets } from "./redact.ts";

export const MIRROR_START = "<!-- t3:memory:start -->";
export const MIRROR_END = "<!-- t3:memory:end -->";

export interface MirrorMemory {
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
}

const KIND_ORDER: ReadonlyArray<readonly [MemoryKind, string]> = [
  ["convention", "Conventions"],
  ["command", "Commands"],
  ["architecture", "Architecture"],
  ["decision", "Decisions"],
  ["gotcha", "Gotchas"],
  ["preference", "Preferences"],
  ["todo", "To do"],
];

const oneLine = (text: string) => redactSecrets(text).replace(/\s+/g, " ").trim();

/** The block written between the markers: generated from the notes, never read back. */
export function renderMirror(memories: ReadonlyArray<MirrorMemory>): string {
  const lines = [
    MIRROR_START,
    "<!-- Generated from T3 Code project notes. Edit the notes in T3 Code; changes here are overwritten. -->",
  ];
  for (const [kind, heading] of KIND_ORDER) {
    const items = memories.filter((memory) => memory.kind === kind);
    if (items.length === 0) continue;
    lines.push("", `### ${heading}`);
    for (const item of items) {
      lines.push(`- **${oneLine(item.title)}**: ${oneLine(item.body)}`);
    }
  }
  lines.push(MIRROR_END);
  return lines.join("\n");
}

/** Replaces the previous block in place, or appends one; everything outside the markers is untouched. */
export function applyMirror(current: string | null, block: string): string {
  if (current === null || current.trim() === "") return `${block}\n`;
  const start = current.indexOf(MIRROR_START);
  const end = current.indexOf(MIRROR_END);
  if (start !== -1 && end > start) {
    return `${current.slice(0, start)}${block}${current.slice(end + MIRROR_END.length)}`;
  }
  return `${current.replace(/\s*$/, "")}\n\n${block}\n`;
}
