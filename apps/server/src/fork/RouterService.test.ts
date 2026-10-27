// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OrchestrationProjectShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import * as RouterService from "./RouterService.ts";
import * as RouterStore from "./RouterStore.ts";

const decodeShell = Schema.decodeUnknownSync(OrchestrationProjectShell);

const makeWorkspace = (name: string, files: Readonly<Record<string, string>>) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `t3-router-${name}-`));
  for (const [file, content] of Object.entries(files)) {
    NodeFS.writeFileSync(NodePath.join(root, file), content);
  }
  return root;
};

const shell = (id: string, title: string, workspaceRoot: string) =>
  decodeShell({
    id,
    title,
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

const layerFor = (
  shells: ReadonlyArray<ReturnType<typeof shell>>,
  scratchProjectIds: ReadonlyArray<string> = [],
) =>
  RouterService.layer().pipe(
    Layer.provideMerge(RouterStore.layer),
    Layer.provideMerge(ForkDatabase.layerMemory),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({ listShells: () => Effect.succeed(shells) }),
    ),
    Layer.provide(
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "",
        isScratchProject: (projectId) => Effect.succeed(scratchProjectIds.includes(projectId)),
      }),
    ),
    Layer.provide(NodeServices.layer),
  );

it.effect("derives profiles from project folders and suggests, never starts", () => {
  const copiador = makeWorkspace("copiador", {
    "README.md": "# Copiador\n\nCopiador de ordens MT5 com slippage e hedge.\n",
  });
  const rota = makeWorkspace("rota", {
    "README.md": "# Rota\n\nGestão de licitações, editais e empenhos públicos.\n",
    "composer.json": "{}",
  });
  return Effect.gen(function* () {
    const router = yield* RouterService.RouterService;
    const result = yield* router.classify({ prompt: "ajuste o slippage do hedge no MT5" });
    assert.equal(result.via, "lexical");
    assert.notEqual(result.mode, "auto");
    assert.equal(result.candidates[0]?.projectId, "copiador-id");
    const store = yield* RouterStore.RouterStore;
    const profiles = yield* store.listProfiles();
    assert.deepEqual(profiles.find((profile) => profile.id === "rota-id")?.stack, ["PHP"]);
  }).pipe(
    Effect.provide(
      layerFor([shell("copiador-id", "Copiador", copiador), shell("rota-id", "Rota", rota)]),
    ),
  );
});

it.effect("ignores stored profiles whose project no longer exists", () => {
  const rota = makeWorkspace("rota-only", { "README.md": "Gestão de licitações e editais." });
  return Effect.gen(function* () {
    const store = yield* RouterStore.RouterStore;
    yield* store.upsertProfile({
      id: "gone-id",
      slug: "gone",
      name: "Gone",
      aliases: [],
      description: "licitações editais empenhos",
      stack: [],
      keywords: [],
    });
    const router = yield* RouterService.RouterService;
    const result = yield* router.classify({ prompt: "crie o edital de licitações" });
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.projectId),
      ["rota-id"],
    );
  }).pipe(Effect.provide(layerFor([shell("rota-id", "Rota", rota)])));
});

it.effect("keeps a corrected choice for later tuning", () =>
  Effect.gen(function* () {
    const router = yield* RouterService.RouterService;
    const store = yield* RouterStore.RouterStore;
    yield* router.recordChoice({
      prompt: "crie o edital",
      suggestedProjectId: "copiador-id",
      chosenProjectId: "rota-id",
    });
    const [entry] = yield* store.recentFeedback({ limit: 1 });
    assert.equal(entry?.chosenProjectId, "rota-id");
    assert.equal(entry?.suggestedProjectId, "copiador-id");
  }).pipe(Effect.provide(layerFor([]))),
);

it.effect("lets the user add aliases and keywords without losing what was derived", () => {
  const rota = makeWorkspace("rota-profile", {
    "README.md": "Gestão de licitações.",
    "composer.json": "{}",
  });
  return Effect.gen(function* () {
    const router = yield* RouterService.RouterService;
    const before = yield* router.getProfile({ projectId: "rota-id" });
    assert.deepEqual(before?.stack, ["PHP"]);
    assert.deepEqual(before?.aliases, []);
    const updated = yield* router.updateProfile({
      projectId: "rota-id",
      aliases: ["pregão"],
      keywords: ["empenho", "ata"],
    });
    assert.deepEqual([updated?.aliases, updated?.keywords], [["pregão"], ["empenho", "ata"]]);
    assert.deepEqual(updated?.stack, ["PHP"]);
    // The next sync keeps the user's edits instead of deriving the profile again.
    const again = yield* router.getProfile({ projectId: "rota-id" });
    assert.deepEqual(again?.keywords, ["empenho", "ata"]);
    const found = yield* router.classify({ prompt: "o pregão do empenho" });
    assert.equal(found.candidates[0]?.projectId, "rota-id");
    assert.equal(yield* router.getProfile({ projectId: "ghost" }), undefined);
  }).pipe(Effect.provide(layerFor([shell("rota-id", "Rota", rota)])));
});

it.effect("derives keywords again for a stored profile that has none", () => {
  const nashia = makeWorkspace("nashia", { "AGENTS.md": "# Nashia\n\nInternal tooling.\n" });
  return Effect.gen(function* () {
    const store = yield* RouterStore.RouterStore;
    yield* store.upsertProfile({
      id: "dev-id",
      slug: "dev",
      name: "dev",
      aliases: [],
      description: "",
      stack: [],
      keywords: [],
    });
    const router = yield* RouterService.RouterService;
    const result = yield* router.classify({ prompt: "what is the status of the nashia project" });
    assert.equal(result.candidates[0]?.projectId, "dev-id");
  }).pipe(Effect.provide(layerFor([shell("dev-id", "dev", nashia)])));
});

it.effect("never offers the no-project scratch space as a destination", () => {
  const scratch = makeWorkspace("scratch", { "README.md": "Scratch space for projectless chats." });
  const rota = makeWorkspace("rota-scratch", { "README.md": "Gestão de licitações." });
  return Effect.gen(function* () {
    const router = yield* RouterService.RouterService;
    const result = yield* router.classify({ prompt: "scratch space for projectless chats" });
    assert.notInclude(
      result.candidates.map((candidate) => candidate.projectId),
      "scratch-id",
    );
  }).pipe(
    Effect.provide(
      layerFor(
        [shell("scratch-id", "No project", scratch), shell("rota-id", "Rota", rota)],
        ["scratch-id"],
      ),
    ),
  );
});
