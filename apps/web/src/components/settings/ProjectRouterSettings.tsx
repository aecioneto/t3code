import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { routerProfileQuery, routerUpdateProfile } from "../../state/router";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";

const splitTerms = (text: string) =>
  Array.from(
    new Set(
      text
        .split(",")
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  );

/** Names and words the router should know a project by, next to what it reads from the folder. */
export function ProjectRouterSettings() {
  const projects = useProjects();
  return (
    <>
      {projects.map((project) => (
        <ProjectRouterRow
          key={`${project.environmentId}:${project.id}`}
          environmentId={project.environmentId}
          projectId={project.id}
          title={project.title}
        />
      ))}
    </>
  );
}

function ProjectRouterRow(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsRow
      title={props.title}
      description="Extra names and words that point a prompt at this project."
      control={
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Edit"}
        </Button>
      }
    >
      {open ? <ProfileEditor {...props} /> : null}
    </SettingsRow>
  );
}

function ProfileEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const { environmentId, projectId } = props;
  const query = useEnvironmentQuery(routerProfileQuery({ environmentId, input: { projectId } }));
  const update = useAtomCommand(routerUpdateProfile, { reportFailure: false });
  const profile = query.data ?? null;
  const [aliases, setAliases] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string | null>(null);

  if (profile === null) {
    return (
      <p className="mt-3 text-muted-foreground text-sm">
        {query.error === null ? "Loading…" : "Could not read this project's profile."}
      </p>
    );
  }
  const aliasText = aliases ?? profile.aliases.join(", ");
  const keywordText = keywords ?? profile.keywords.join(", ");

  const save = async () => {
    const result = await update({
      environmentId,
      input: { projectId, aliases: splitTerms(aliasText), keywords: splitTerms(keywordText) },
    });
    if (result._tag !== "Success") {
      toastManager.add({ type: "error", title: "Could not save the names" });
      return;
    }
    setAliases(null);
    setKeywords(null);
    query.refresh();
  };

  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {profile.stack.length > 0 ? `Stack: ${profile.stack.join(", ")}. ` : ""}
        {profile.description === "" ? "No description found." : profile.description}
      </p>
      <label className="flex flex-col gap-1">
        Other names (comma separated)
        <Input value={aliasText} onChange={(event) => setAliases(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        Words that mean this project (comma separated)
        <Input value={keywordText} onChange={(event) => setKeywords(event.target.value)} />
      </label>
      <div>
        <Button
          size="sm"
          disabled={aliases === null && keywords === null}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
