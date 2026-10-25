export type ModelSpec =
  | { readonly kind: "off" }
  | { readonly kind: "claude-cli"; readonly model: string }
  | { readonly kind: "ollama"; readonly model: string };

/**
 * `off` and `lexical-only` call nothing; `ollama:<model>` stays on the machine;
 * `claude-<model>` goes through the Claude CLI the user already signed in to.
 */
export function parseModelSpec(value: string): ModelSpec {
  const text = value.trim();
  if (text.startsWith("ollama:") && text.length > "ollama:".length) {
    return { kind: "ollama", model: text.slice("ollama:".length) };
  }
  if (text.startsWith("claude-") && text.length > "claude-".length) {
    return { kind: "claude-cli", model: text.slice("claude-".length) };
  }
  return { kind: "off" };
}
