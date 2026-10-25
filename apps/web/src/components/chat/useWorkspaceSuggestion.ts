import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useState } from "react";

import { environmentPresentations } from "~/state/presentation";
import { routerPlanWorkspace } from "~/state/router";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  pickWorkspaceSuggestion,
  ROUTER_MIN_PROMPT_CHARS,
  type WorkspaceSuggestion,
} from "./routerSuggestion.logic";

const ROUTER_DEBOUNCE_MS = 600;

export function useWorkspaceSuggestion(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly prompt: string;
  readonly currentEnvMode: "local" | "worktree";
}): WorkspaceSuggestion | null {
  const plan = useAtomCommand(routerPlanWorkspace, { reportFailure: false, reportDefect: false });
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly suggestion: WorkspaceSuggestion | null;
  } | null>(null);
  const { environmentId, projectId, currentEnvMode } = input;
  const prompt = input.prompt.trim();
  const serverConfigs = useAtomValue(environmentPresentations.serverConfigsAtom);
  const enabled =
    environmentId !== null &&
    projectId !== null &&
    serverConfigs.get(environmentId)?.settings.routerEnabled === true;
  const eligible = enabled && prompt.length >= ROUTER_MIN_PROMPT_CHARS;
  const key = `${environmentId}|${projectId}|${currentEnvMode}|${prompt}`;

  const runPlan = useEffectEvent(
    async (target: EnvironmentId, targetProject: ProjectId, requestKey: string) => {
      const result = await plan({
        environmentId: target,
        input: { projectId: targetProject, prompt },
      });
      setAnswer({
        key: requestKey,
        suggestion:
          result._tag === "Success" ? pickWorkspaceSuggestion(result.value, currentEnvMode) : null,
      });
    },
  );

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => void runPlan(environmentId, projectId, key), ROUTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [eligible, environmentId, projectId, key]);

  return eligible && answer?.key === key ? answer.suggestion : null;
}
