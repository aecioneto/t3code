import type { EnvironmentId, RouterCandidate } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { environmentPresentations } from "~/state/presentation";
import { routerClassify } from "~/state/router";
import { useAtomCommand } from "~/state/use-atom-command";
import { pickRouterSuggestion, ROUTER_MIN_PROMPT_CHARS } from "./routerSuggestion.logic";

const ROUTER_DEBOUNCE_MS = 600;

export function useRouterSuggestion(input: {
  readonly environmentId: EnvironmentId | null;
  readonly prompt: string;
  readonly activeProjectId: string | null;
  /** Called once per prompt when the router is sure enough to switch without asking. */
  readonly onAutoSwitch: (candidate: RouterCandidate) => void;
}): RouterCandidate | null {
  const classify = useAtomCommand(routerClassify, { reportFailure: false, reportDefect: false });
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly suggestion: RouterCandidate | null;
  } | null>(null);
  const { environmentId, activeProjectId } = input;
  const autoSwitchedPrompt = useRef<string | null>(null);
  const prompt = input.prompt.trim();
  const serverConfigs = useAtomValue(environmentPresentations.serverConfigsAtom);
  const enabled =
    environmentId !== null && serverConfigs.get(environmentId)?.settings.routerEnabled === true;
  const eligible = enabled && prompt.length >= ROUTER_MIN_PROMPT_CHARS;
  const key = `${environmentId}|${activeProjectId}|${prompt}`;

  const runClassify = useEffectEvent(async (target: EnvironmentId, requestKey: string) => {
    const result = await classify({ environmentId: target, input: { prompt } });
    const suggestion =
      result._tag === "Success" ? pickRouterSuggestion(result.value, activeProjectId) : null;
    setAnswer({ key: requestKey, suggestion });
    // A reply for an earlier keystroke must not switch the draft, and a switch the user
    // undoes is not repeated for the same prompt.
    if (
      suggestion !== null &&
      result._tag === "Success" &&
      result.value.mode === "auto" &&
      requestKey === key &&
      autoSwitchedPrompt.current !== prompt
    ) {
      autoSwitchedPrompt.current = prompt;
      input.onAutoSwitch(suggestion);
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounce timer: waits for typing to pause before asking the router
  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => void runClassify(environmentId, key), ROUTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [eligible, environmentId, key]);

  return eligible && answer?.key === key ? answer.suggestion : null;
}
