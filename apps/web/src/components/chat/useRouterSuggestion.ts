import type { EnvironmentId, RouterCandidate } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { routerClassify } from "~/state/router";
import { useAtomCommand } from "~/state/use-atom-command";
import { pickRouterSuggestion, ROUTER_MIN_PROMPT_CHARS } from "./routerSuggestion.logic";

const ROUTER_DEBOUNCE_MS = 600;

export function useRouterSuggestion(input: {
  readonly environmentId: EnvironmentId | null;
  readonly prompt: string;
  readonly activeProjectId: string | null;
}): RouterCandidate | null {
  const classify = useAtomCommand(routerClassify, { reportFailure: false, reportDefect: false });
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly suggestion: RouterCandidate | null;
  } | null>(null);
  const { environmentId, activeProjectId } = input;
  const prompt = input.prompt.trim();
  const eligible = environmentId !== null && prompt.length >= ROUTER_MIN_PROMPT_CHARS;
  const key = `${environmentId}|${activeProjectId}|${prompt}`;

  const runClassify = useEffectEvent(async (target: EnvironmentId, requestKey: string) => {
    const result = await classify({ environmentId: target, input: { prompt } });
    setAnswer({
      key: requestKey,
      suggestion:
        result._tag === "Success" ? pickRouterSuggestion(result.value, activeProjectId) : null,
    });
  });

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => void runClassify(environmentId, key), ROUTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [eligible, environmentId, key]);

  return eligible && answer?.key === key ? answer.suggestion : null;
}
