import type { EnvironmentId, ProjectId, RouterWorkspacePlan } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useState } from "react";

import { environmentPresentations } from "~/state/presentation";
import { routerPlanWorkspace } from "~/state/router";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  pickThreadSuggestion,
  pickWorkspaceSuggestion,
  ROUTER_MIN_PROMPT_CHARS,
  type ThreadSuggestion,
  type WorkspaceSuggestion,
} from "./routerSuggestion.logic";

const ROUTER_DEBOUNCE_MS = 600;

export function useWorkspaceSuggestion(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly prompt: string;
  readonly currentEnvMode: "local" | "worktree";
}): {
  readonly workspace: WorkspaceSuggestion | null;
  readonly thread: ThreadSuggestion | null;
} {
  const requestPlan = useAtomCommand(routerPlanWorkspace, {
    reportFailure: false,
    reportDefect: false,
  });
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly plan: RouterWorkspacePlan | null;
  } | null>(null);
  const { environmentId, projectId, currentEnvMode } = input;
  const prompt = input.prompt.trim();
  const serverConfigs = useAtomValue(environmentPresentations.serverConfigsAtom);
  const enabled =
    environmentId !== null &&
    projectId !== null &&
    serverConfigs.get(environmentId)?.settings.routerEnabled === true;
  const eligible = enabled && prompt.length >= ROUTER_MIN_PROMPT_CHARS;
  const key = `${environmentId}|${projectId}|${prompt}`;

  const runPlan = useEffectEvent(
    async (target: EnvironmentId, targetProject: ProjectId, requestKey: string) => {
      const result = await requestPlan({
        environmentId: target,
        input: { projectId: targetProject, prompt },
      });
      setAnswer({
        key: requestKey,
        plan: result._tag === "Success" ? result.value : null,
      });
    },
  );

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => void runPlan(environmentId, projectId, key), ROUTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [eligible, environmentId, projectId, key]);

  const plan = eligible && answer?.key === key ? answer.plan : null;
  return {
    workspace: plan === null ? null : pickWorkspaceSuggestion(plan, currentEnvMode),
    thread: plan === null ? null : pickThreadSuggestion(plan),
  };
}
