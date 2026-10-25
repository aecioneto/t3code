import type { EnvironmentId, MemoryKind, ProjectId } from "@t3tools/contracts";
import { MemoryKind as MemoryKindSchema } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProjects } from "../../state/entities";
import { memoryCreate, memoryDelete, memoryListQuery, memoryUpdate } from "../../state/memory";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";

const NOTE_PAGE_SIZE = 50;

/** One row per project: the opt-in switch, and the notes behind a toggle. */
export function ProjectMemorySettings() {
  const projects = useProjects();
  if (projects.length === 0) return null;
  return (
    <>
      {projects.map((project) => (
        <ProjectMemoryRow key={`${project.environmentId}:${project.id}`} project={project} />
      ))}
    </>
  );
}

function ProjectMemoryRow({
  project,
}: {
  readonly project: ReturnType<typeof useProjects>[number];
}) {
  const enabledIds = useEnvironmentSettings(
    project.environmentId,
    (settings) => settings.memoryEnabledProjectIds,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const enabled = enabledIds.includes(project.id);

  const toggle = async (checked: boolean) => {
    const next = checked
      ? [...enabledIds, project.id]
      : enabledIds.filter((projectId) => projectId !== project.id);
    const result = await updateSettings({
      environmentId: project.environmentId,
      input: { patch: { memoryEnabledProjectIds: next } },
    });
    if (result._tag !== "Success") {
      toastManager.add({ type: "error", title: "Memory setting not saved" });
    }
  };

  return (
    <SettingsRow
      title={project.title}
      description={
        enabled
          ? "Agents in this project can save and recall notes."
          : "Off. Agents in this project cannot read or save notes."
      }
      control={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide notes" : "Notes"}
          </Button>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => void toggle(Boolean(checked))}
            aria-label={`Memory for ${project.title}`}
          />
        </div>
      }
    >
      {open ? (
        <ProjectNotes
          environmentId={project.environmentId}
          projectId={project.id}
          canAdd={enabled}
        />
      ) : null}
    </SettingsRow>
  );
}

function ProjectNotes(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly canAdd: boolean;
}) {
  const { environmentId, projectId } = props;
  const create = useAtomCommand(memoryCreate, { reportFailure: false });
  const update = useAtomCommand(memoryUpdate, { reportFailure: false });
  const remove = useAtomCommand(memoryDelete, { reportFailure: false });
  const query = useEnvironmentQuery(
    memoryListQuery({ environmentId, input: { projectId, limit: NOTE_PAGE_SIZE } }),
  );
  const notes = query.data?.memories ?? null;
  const [draft, setDraft] = useState<{
    kind: MemoryKind;
    title: string;
    body: string;
  } | null>(null);

  const run = async (action: Promise<{ readonly _tag: string }>, failure: string) => {
    const result = await action;
    if (result._tag !== "Success") {
      toastManager.add({ type: "error", title: failure });
      return false;
    }
    query.refresh();
    return true;
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      {notes === null ? (
        <p className="text-muted-foreground text-sm">
          {query.error === null ? "Loading…" : "Could not load notes."}
        </p>
      ) : null}
      {notes?.length === 0 ? <p className="text-muted-foreground text-sm">No notes yet.</p> : null}
      {notes?.map((note) => (
        <div key={note.id} className="rounded-md border p-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{note.kind}</Badge>
            {note.status === "pending_review" ? <Badge variant="info">Needs review</Badge> : null}
            {note.pinned ? <Badge variant="outline">Pinned</Badge> : null}
            <span className="min-w-0 flex-1 truncate font-medium">{note.title}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{note.body}</p>
          <div className="mt-2 flex gap-2">
            {note.status === "pending_review" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void run(
                    update({
                      environmentId,
                      input: { projectId, id: note.id, patch: { status: "active" } },
                    }),
                    "Could not approve the note",
                  )
                }
              >
                Approve
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void run(
                  update({
                    environmentId,
                    input: { projectId, id: note.id, patch: { pinned: !note.pinned } },
                  }),
                  "Could not update the note",
                )
              }
            >
              {note.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void run(
                  remove({ environmentId, input: { projectId, id: note.id } }),
                  "Could not delete the note",
                )
              }
            >
              Delete
            </Button>
          </div>
        </div>
      ))}
      {draft === null ? (
        props.canAdd ? (
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDraft({ kind: "convention", title: "", body: "" })}
            >
              Add note
            </Button>
          </div>
        ) : null
      ) : (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <Select
            value={draft.kind}
            onValueChange={(value) => {
              if (MemoryKindSchema.literals.includes(value as MemoryKind)) {
                setDraft({ ...draft, kind: value as MemoryKind });
              }
            }}
          >
            <SelectTrigger size="sm" aria-label="Note kind">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {MemoryKindSchema.literals.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Input
            placeholder="Title"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <Textarea
            placeholder="What should agents remember?"
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={draft.title.trim() === "" || draft.body.trim() === ""}
              onClick={() =>
                void run(
                  create({ environmentId, input: { projectId, ...draft } }),
                  "Could not save the note",
                ).then((saved) => {
                  if (saved) setDraft(null);
                })
              }
            >
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
