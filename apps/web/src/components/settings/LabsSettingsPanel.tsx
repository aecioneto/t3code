import { useAuth } from "@clerk/react";
import { Link } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ProjectMemorySettings } from "./ProjectMemorySettings";
import { ProjectRouterSettings } from "./ProjectRouterSettings";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { LegacyFeaturesSection } from "./SettingsPanels";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Features still settling in, and legacy behavior kept for people who rely on it. */
export function LabsSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsPageContainer>
      <SettingsSection id="beta" title="Beta">
        <BoringSidebarRow />
        <BoringSidebarMultilineRow />
        <SettingsRow
          serverScoped
          {...searchableSetting("project-router")}
          settingKeys={["routerEnabled"]}
          description="While you write a new thread, suggest the project that fits your prompt. It only suggests; you choose whether to switch."
          control={
            <ScopedSwitch
              settingKeys={["routerEnabled"]}
              checked={settings.routerEnabled}
              onCheckedChange={(checked) => updateSettings({ routerEnabled: Boolean(checked) })}
              aria-label="Project suggestions"
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("new-thread-without-project")}
          settingKeys={["newThreadWithoutProject"]}
          description="With project suggestions on, the New thread button starts without a project and the suggestion picks one as you write. Shift-click still starts in the current project."
          control={
            <ScopedSwitch
              settingKeys={["newThreadWithoutProject"]}
              checked={settings.newThreadWithoutProject}
              onCheckedChange={(checked) =>
                updateSettings({ newThreadWithoutProject: Boolean(checked) })
              }
              aria-label="New threads start without a project"
            />
          }
        />
        {/* Clerk is only mounted when this build has T3 Connect. */}
        {hasCloudPublicConfig() ? <GuestLinksRowWithSignIn /> : <GuestLinksRow />}
        <LinkedEnvironmentsRow />
        <SimlockHostsRow />
      </SettingsSection>
      <SettingsSection id="project-suggestions" title="Project names">
        <ProjectRouterSettings />
      </SettingsSection>
      <SettingsSection id="project-memory" title="Project memory">
        <SettingsRow
          serverScoped
          {...searchableSetting("memory-extractor")}
          settingKeys={["memoryExtractor"]}
          title="Write notes automatically"
          description="After a run that changed files, a model reads a short summary (paths and counts, secrets removed) and proposes notes. They wait for your review at first. Off sends nothing anywhere. Claude Haiku uses the Claude CLI you are signed in to, so the summary goes to Anthropic."
          control={
            <Select
              value={settings.memoryExtractor === "claude-haiku" ? "claude-haiku" : "off"}
              onValueChange={(value) => {
                if (value === "off" || value === "claude-haiku") {
                  updateSettings({ memoryExtractor: value });
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Automatic notes">
                <SelectValue>
                  {(value: string | null) => (value === "claude-haiku" ? "Claude Haiku" : "Off")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="claude-haiku">Claude Haiku</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["memoryKeepWords"]}
          title="Words memory search keeps"
          description="Memory search ignores common words like “the” or “de”. List words your notes use as real terms, separated by commas."
          control={<MemoryKeepWordsInput />}
        />
        <ProjectMemorySettings />
      </SettingsSection>
      <LegacyFeaturesSection />
    </SettingsPageContainer>
  );
}

function MemoryKeepWordsInput() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const saved = settings.memoryKeepWords.join(", ");
  return (
    <Input
      key={saved}
      className="w-56"
      defaultValue={saved}
      aria-label="Words memory search keeps"
      onBlur={(event) => {
        const words = event.target.value
          .split(",")
          .map((word) => word.trim())
          .filter((word) => word.length > 0);
        if (words.join(", ") !== saved) updateSettings({ memoryKeepWords: words });
      }}
    />
  );
}

function BoringSidebarRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("boring-sidebar")}
      description="Group sidebar threads into project folders. Pinned threads stay on top, and Snoozed and Settled stay below the folders."
      control={
        <Switch
          checked={settings.boringSidebarEnabled || settings.legacySidebarEnabled}
          // Turning it off also clears the opt-in of the removed legacy sidebar.
          onCheckedChange={(checked) =>
            updateSettings({ boringSidebarEnabled: Boolean(checked), legacySidebarEnabled: false })
          }
          aria-label="Boring sidebar (group by project)"
        />
      }
    />
  );
}

function BoringSidebarMultilineRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("boring-sidebar-multiline")}
      description="In the boring sidebar, show folder threads on two lines: the title, then the branch, pull request, and agent."
      control={
        <Switch
          checked={settings.boringSidebarMultilineRows}
          onCheckedChange={(checked) =>
            updateSettings({ boringSidebarMultilineRows: Boolean(checked) })
          }
          aria-label="Two-line folder rows"
        />
      }
    />
  );
}

/** Signed out of T3 Connect, the row offers to sign in instead of its switch. */
function GuestLinksRowWithSignIn() {
  const { isSignedIn } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  // `isSignedIn` is undefined until Clerk loads.
  if (isSignedIn !== false) return <GuestLinksRow />;
  return (
    <SettingsRow
      {...searchableSetting("guest-links")}
      description="Share a thread with a guest who watches it live in their browser and sends messages you approve. Sign in to T3 Connect to use guest links."
      control={
        <Button size="sm" variant="outline" onClick={openAuthPrompt}>
          Sign in
        </Button>
      }
    />
  );
}

function GuestLinksRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("guest-links")}
      settingKeys={["guestSharingEnabled"]}
      description={
        <>
          Share a thread with a guest who watches it live in their browser and sends messages you
          approve. Needs T3 Connect: sign in and link this machine in{" "}
          <Link to="/settings/access" className="underline underline-offset-2">
            Sharing & access
          </Link>
          . While it is off, every guest link stops working.
        </>
      }
      control={
        <ScopedSwitch
          settingKeys={["guestSharingEnabled"]}
          checked={settings.guestSharingEnabled}
          onCheckedChange={(checked) => updateSettings({ guestSharingEnabled: Boolean(checked) })}
          aria-label="Guest links"
        />
      }
    />
  );
}

function LinkedEnvironmentsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("linked-environments-beta")}
      settingKeys={["linkedEnvironmentsEnabled"]}
      description={
        <>
          Let agents here work on your other machines, and theirs here. Turn it on for each machine,
          then link them in{" "}
          <Link to="/settings/connections" className="underline underline-offset-2">
            Connections
          </Link>
          . While it is off, nothing new starts over a link; tasks already running finish.
        </>
      }
      control={
        <ScopedSwitch
          settingKeys={["linkedEnvironmentsEnabled"]}
          checked={settings.linkedEnvironmentsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ linkedEnvironmentsEnabled: Boolean(checked) })
          }
          aria-label="Linked environments"
        />
      }
    />
  );
}

function SimlockHostsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("simlock-hosts")}
      settingKeys={["simlockDeviceHostsEnabled"]}
      description={
        <>
          Let the Device panel lease simulators and emulators from your own{" "}
          <a
            href="https://incubator.callstack.com/simlock/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Simlock
          </a>{" "}
          pool, added in{" "}
          <Link to="/settings/devices" className="underline underline-offset-2">
            Devices
          </Link>
          . An alpha that may change or break. T3 Code never installs Simlock.
        </>
      }
      control={
        <ScopedSwitch
          settingKeys={["simlockDeviceHostsEnabled"]}
          checked={settings.simlockDeviceHostsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ simlockDeviceHostsEnabled: Boolean(checked) })
          }
          aria-label="Simlock device hosts"
        />
      }
    />
  );
}
