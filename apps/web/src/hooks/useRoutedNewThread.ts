import { useAtomValue } from "@effect/atom-react";

import { usePrimaryEnvironmentId } from "~/state/environments";
import { environmentPresentations } from "~/state/presentation";
import { useScratchProject } from "./useScratchProject";

// Returns whether it handled the request, so callers fall back to choosing a project.
export function useRoutedNewThread() {
  const serverConfigs = useAtomValue(environmentPresentations.serverConfigsAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();

  return (): boolean => {
    if (primaryEnvironmentId === null) return false;
    const settings = serverConfigs.get(primaryEnvironmentId)?.settings;
    if (settings?.routerEnabled !== true || settings.newThreadWithoutProject !== true) return false;
    const environmentId = scratchEnvironmentId(primaryEnvironmentId);
    if (environmentId === null) return false;
    void startScratchThread(environmentId);
    return true;
  };
}
