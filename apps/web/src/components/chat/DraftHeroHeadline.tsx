import type { DraftId } from "~/composerDraftStore";
import { composerDraftHasUserContent, useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { buildThreadRouteParams } from "~/threadRoutes";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { FolderPlusIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import { routerRecordChoice, routerRecordWorkspaceChoice } from "~/state/router";
import { useAtomCommand } from "~/state/use-atom-command";
import { DraftProjectName } from "./DraftProjectName";
import { ROUTER_MIN_PROMPT_CHARS } from "./routerSuggestion.logic";
import { useRouterSuggestion } from "./useRouterSuggestion";
import { useWorkspaceSuggestion } from "./useWorkspaceSuggestion";
import { DraftHeroProjectHeading } from "./DraftHeroProjectHeading";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

const ADD_PROJECT_VALUE = "add-project";

interface PickerItem {
  readonly value: string;
  readonly label: string;
}

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const openAddProject = () => openCommandPalette({ open: "add-project" });
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const openProjectDraft = useNewThreadHandler();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const draftPrompt = useComposerDraftStore((store) =>
    draftId ? (store.getComposerDraft(draftId)?.prompt ?? "") : "",
  );
  const recordRouterChoice = useAtomCommand(routerRecordChoice, {
    reportFailure: false,
    reportDefect: false,
  });
  const routerSuggestion = useRouterSuggestion({
    environmentId: activeProjectRef?.environmentId ?? null,
    prompt: draftPrompt,
    activeProjectId: activeProjectRef?.projectId ?? null,
  });
  const draftEnvMode = useComposerDraftStore((store) =>
    draftId ? (store.getDraftThread(draftId)?.envMode ?? "local") : "local",
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const recordWorkspaceChoice = useAtomCommand(routerRecordWorkspaceChoice, {
    reportFailure: false,
    reportDefect: false,
  });
  const [dismissedWorkspacePrompt, setDismissedWorkspacePrompt] = useState<string | null>(null);
  const { workspace: workspaceSuggestion, thread: threadSuggestion } = useWorkspaceSuggestion({
    environmentId: activeProjectRef?.environmentId ?? null,
    projectId: activeProjectRef?.projectId ?? null,
    prompt: draftPrompt,
    currentEnvMode: draftEnvMode,
  });
  const navigate = useNavigate();
  const suggestedThread =
    threadSuggestion === null || activeProjectRef === null
      ? null
      : (threads.find(
          (thread) =>
            thread.environmentId === activeProjectRef.environmentId &&
            thread.id === threadSuggestion.threadId,
        ) ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerFilter = useComboboxFilter();

  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectGroups = sortLogicalProjectsForSidebar(
    buildSidebarProjectSnapshots({
      projects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
    }),
    threads,
    projectSortOrder,
  );
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const environmentMachineById = new Map(
    environments.map(
      (environment) =>
        [
          environment.environmentId,
          resolveEnvironmentMachineKind(environment.serverConfig),
        ] as const,
    ),
  );
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: projectGroups,
    preferredProjectRef: activeProjectRef,
  });
  const projectEntryByKey = new Map(
    projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const),
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) =>
      !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
  );
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentId(
    activeProjectRef?.environmentId ?? primaryEnvironmentId,
  );
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft =
    activeProject !== null && isScratchProject(activeProject, scratchWorkspaceRoot);

  const pickerItems: readonly PickerItem[] = [
    ...menuEntries.map(({ group }) => ({ value: group.projectKey, label: group.displayName })),
    { value: ADD_PROJECT_VALUE, label: "Add project" },
  ];
  const pickerSearch = pickerQuery.trim();
  const filteredPickerItems =
    pickerSearch.length === 0
      ? pickerItems
      : pickerItems.filter(
          (item) =>
            item.value !== ADD_PROJECT_VALUE &&
            pickerFilter.contains(item, pickerSearch, (candidate) => candidate.label),
        );
  const selectedPickerItem = pickerItems.find((item) => item.value === activeProjectKey) ?? null;

  // The picker can change the draft's target while the no-project home is
  // still being opened; a stale continuation must not retarget it again. Picking
  // a project clears the pending request, and the draft session is compared
  // against the store when the scratch project arrives.
  const pendingScratchRef = useRef<symbol | null>(null);
  const draftTargetKey = () => {
    const session = draftId ? useComposerDraftStore.getState().getDraftSession(draftId) : null;
    return session
      ? `${session.environmentId}:${session.projectId}:${session.logicalProjectKey}`
      : null;
  };
  // Retargeting an empty draft would overwrite the project's draft and strand browser tabs.
  const selectProject = (project: (typeof projects)[number], logicalProjectKey: string) => {
    if (!draftId) {
      return;
    }
    pendingScratchRef.current = null;
    const currentDraft = getComposerDraft(draftId);
    if (!composerDraftHasUserContent(currentDraft)) {
      void openProjectDraft(scopeProjectRef(project.environmentId, project.id));
      return;
    }
    setLogicalProjectDraftThreadId(
      logicalProjectKey,
      scopeProjectRef(project.environmentId, project.id),
      draftId,
    );
    if (!hasExplicitComposerModelSelection(currentDraft)) {
      applyStickyState(draftId);
      const environmentSettings = environments.find(
        (environment) => environment.environmentId === project.environmentId,
      )?.serverConfig?.settings;
      const defaultModelSelection = environmentSettings
        ? resolveProjectSettings(environmentSettings, project.id, project).settings
            .defaultModelSelection
        : project.defaultModelSelection;
      if (defaultModelSelection) {
        setModelSelection(draftId, defaultModelSelection, {
          replaceOptions: true,
        });
      }
    }
  };
  const suggestedProject =
    routerSuggestion === null || activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === routerSuggestion.projectId,
        ) ?? null);
  // A pick the router did not suggest is the correction worth learning from.
  const recordPickerChoice = (project: (typeof projects)[number]) => {
    const prompt = draftPrompt.trim();
    if (activeProjectRef === null || prompt.length < ROUTER_MIN_PROMPT_CHARS) {
      return;
    }
    void recordRouterChoice({
      environmentId: project.environmentId,
      input: {
        prompt,
        suggestedProjectId: routerSuggestion?.projectId ?? activeProjectRef.projectId,
        chosenProjectId: project.id,
      },
    });
  };
  // Both answers are recorded: agreement is measured against what the user actually kept.
  const answerWorkspace = (chosen: "current" | "worktree") => {
    if (workspaceSuggestion === null || activeProjectRef === null) {
      return;
    }
    void recordWorkspaceChoice({
      environmentId: activeProjectRef.environmentId,
      input: {
        projectId: activeProjectRef.projectId,
        prompt: draftPrompt.trim(),
        nature: workspaceSuggestion.nature,
        filesEstimate: workspaceSuggestion.filesEstimate,
        layers: workspaceSuggestion.layers,
        suggested: workspaceSuggestion.envMode === "worktree" ? "worktree" : "current",
        chosen: chosen === "worktree" ? "worktree" : "current",
      },
    });
  };
  const acceptRouterSuggestion = () => {
    if (suggestedProject === null || activeProjectRef === null) {
      return;
    }
    void recordRouterChoice({
      environmentId: activeProjectRef.environmentId,
      input: {
        prompt: draftPrompt.trim(),
        suggestedProjectId: suggestedProject.id,
        chosenProjectId: suggestedProject.id,
      },
    });
    selectProject(
      suggestedProject,
      deriveLogicalProjectKeyFromSettings(suggestedProject, projectGroupingSettings),
    );
  };
  const startScratch = async (): Promise<boolean> => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) {
      return false;
    }
    const request = Symbol("scratch");
    pendingScratchRef.current = request;
    const requestedTarget = draftTargetKey();
    const project = await openScratchProject(scratchTargetEnvironmentId);
    if (!project || pendingScratchRef.current !== request || draftTargetKey() !== requestedTarget) {
      return false;
    }
    pendingScratchRef.current = null;
    selectProject(project, deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings));
    return true;
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Combobox
      items={pickerItems}
      filteredItems={filteredPickerItems}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={pickerOpen}
      onOpenChange={(open) => {
        setPickerOpen(open);
        setPickerQuery("");
      }}
      value={selectedPickerItem}
      onValueChange={(item) => {
        if (!item) return;
        setPickerOpen(false);
        if (item.value === ADD_PROJECT_VALUE) {
          openAddProject();
          return;
        }
        const entry = projectEntryByKey.get(item.value);
        if (!entry || item.value === activeProjectKey) {
          return;
        }
        recordPickerChoice(entry.targetProject);
        selectProject(entry.targetProject, entry.group.projectKey);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<InlineButton tone="picker" />}
              data-draft-project-trigger=""
              className="pointer-events-auto min-w-0 max-w-full align-baseline"
            />
          }
        >
          <DraftProjectName
            value={isScratchDraft ? "No project" : (activeProjectDisplayName ?? "Choose a project")}
            singleLine
          />
        </TooltipTrigger>
        {activeProjectDisplayName && !isScratchDraft ? (
          <TooltipPopup side="top">{activeProjectDisplayName}</TooltipPopup>
        ) : null}
      </Tooltip>
      <ComboboxPopup align="center" className="w-72 overflow-hidden">
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects..."
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList>
          {(item: PickerItem) => {
            const entry = projectEntryByKey.get(item.value);
            return (
              <ComboboxItem key={item.value} hideIndicator value={item}>
                {item.value === ADD_PROJECT_VALUE ? (
                  <FolderPlusIcon className="size-4 shrink-0" />
                ) : entry ? (
                  <ProjectFavicon project={entry.group} className="size-4 shrink-0" />
                ) : null}
                <Tooltip>
                  <TooltipTrigger render={<span className="min-w-0 flex-1 text-sm" />}>
                    <DraftProjectName value={item.label} />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{item.label}</TooltipPopup>
                </Tooltip>
                {entry && showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={entry.group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={environmentMachineById}
                  />
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline min-w-0 max-w-full cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <DraftProjectName value={activeProjectTitle ?? "Add a project"} singleLine />
    </button>
  );

  const noProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newWithoutProject");
  const orStartWithoutProject =
    scratchWorkspaceRoot !== null && !isScratchDraft && (hasResolvedProject || canChooseProject) ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              tone="muted"
              className="pointer-events-auto"
              onClick={() =>
                void startScratch().then((started) => {
                  if (started) {
                    document.querySelector<HTMLElement>("[data-draft-project-trigger]")?.focus();
                  }
                })
              }
            />
          }
        >
          or start without a project
        </TooltipTrigger>
        {noProjectShortcut ? <TooltipPopup side="bottom">{noProjectShortcut}</TooltipPopup> : null}
      </Tooltip>
    ) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      {hasResolvedProject && !isScratchDraft ? (
        <DraftHeroProjectHeading projectName={activeProjectDisplayName ?? "Choose a project"}>
          {projectSelector}
        </DraftHeroProjectHeading>
      ) : (
        <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
          {isScratchDraft ? (
            <>What should we work on?</>
          ) : canChooseProject ? (
            <>{projectSelector} to start</>
          ) : (
            <>Add a project to start</>
          )}
        </h1>
      )}
      {suggestedProject === null ? null : (
        <p className="mt-2 flex h-6 w-full items-center justify-center text-sm">
          <InlineButton
            tone="muted"
            className="pointer-events-auto"
            onClick={acceptRouterSuggestion}
          >
            Looks like {suggestedProject.title}. Switch project
          </InlineButton>
        </p>
      )}
      {suggestedThread === null || threadSuggestion === null ? null : (
        <p className="mt-2 flex h-6 w-full items-center justify-center gap-2 text-sm">
          <InlineButton
            tone="muted"
            className="pointer-events-auto"
            onClick={() =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(
                  scopeThreadRef(suggestedThread.environmentId, suggestedThread.id),
                ),
              })
            }
          >
            {threadSuggestion.action === "send"
              ? `"${suggestedThread.title}" already covers this. Open it`
              : threadSuggestion.action === "queue"
                ? `"${suggestedThread.title}" covers this but is busy. Open it`
                : `"${suggestedThread.title}" is almost out of context, so a fresh thread is better. Open it anyway`}
          </InlineButton>
        </p>
      )}
      {workspaceSuggestion === null ||
      draftId === null ||
      activeProjectRef === null ||
      dismissedWorkspacePrompt === draftPrompt.trim() ? null : (
        <p className="mt-2 flex h-6 w-full items-center justify-center gap-2 text-sm">
          <InlineButton
            tone="muted"
            className="pointer-events-auto"
            onClick={() => {
              answerWorkspace(workspaceSuggestion.envMode === "worktree" ? "worktree" : "current");
              setDraftThreadContext(draftId, {
                envMode: workspaceSuggestion.envMode,
                ...(workspaceSuggestion.envMode === "worktree" ? { worktreePath: null } : {}),
              });
            }}
          >
            {workspaceSuggestion.ask
              ? `Unsure (${workspaceSuggestion.reason}). ${workspaceSuggestion.envMode === "worktree" ? "Try a new worktree" : "Work in the current checkout"}`
              : workspaceSuggestion.envMode === "worktree"
                ? `Looks like ${workspaceSuggestion.reason}. Use a new worktree`
                : `Looks like ${workspaceSuggestion.reason}. Work in the current checkout`}
          </InlineButton>
          <InlineButton
            tone="muted"
            className="pointer-events-auto"
            onClick={() => {
              answerWorkspace(draftEnvMode === "worktree" ? "worktree" : "current");
              setDismissedWorkspacePrompt(draftPrompt.trim());
            }}
          >
            Keep mine
          </InlineButton>
        </p>
      )}
      {scratchWorkspaceRoot === null ? null : (
        <p className="mt-2 flex h-6 w-full items-center justify-center text-sm">
          {isScratchDraft ? projectSelector : orStartWithoutProject}
        </p>
      )}
    </div>
  );
}
