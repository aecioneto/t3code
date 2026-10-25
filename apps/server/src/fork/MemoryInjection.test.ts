import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import { memoryNotesFor, withMemoryNotes } from "./MemoryInjection.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";

const layer = MemoryService.layer.pipe(
  Layer.provideMerge(MemoryStore.layer),
  Layer.provideMerge(ForkDatabase.layerMemory),
  Layer.provide(ServerSettings.layerTest({ memoryEnabledProjectIds: ["p1", "p2"] })),
);

const seed = Effect.gen(function* () {
  const memory = yield* MemoryService.MemoryService;
  const base = { projectId: "p1", origin: "user" as const };
  yield* memory.write({
    ...base,
    kind: "convention",
    title: "Prefixo rtk",
    body: "Todo comando começa com rtk",
  });
  yield* memory.write({
    ...base,
    kind: "gotcha",
    title: "Cache do Rails",
    body: "Limpar tmp/cache ao trocar de branch",
  });
  yield* memory.write({ ...base, kind: "decision", title: "Fila", body: "Usar sidekiq para jobs" });
});

it.effect("brings conventions plus the notes that match the prompt, once per native thread", () =>
  Effect.gen(function* () {
    yield* seed;
    const memory = yield* Effect.serviceOption(MemoryService.MemoryService);
    const first = yield* memoryNotesFor({
      memory,
      projectId: "p1",
      prompt: "problema de cache ao trocar branch",
      providerTurnOrdinal: 1,
    });
    assert.ok(first?.includes("Prefixo rtk"));
    assert.ok(first?.includes("Cache do Rails"));
    assert.ok(!first?.includes("sidekiq"));
    assert.equal(
      yield* memoryNotesFor({ memory, projectId: "p1", prompt: "cache", providerTurnOrdinal: 2 }),
      null,
    );
    assert.equal(
      yield* memoryNotesFor({ memory, projectId: "p2", prompt: "cache", providerTurnOrdinal: 1 }),
      null,
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("adds nothing when the memory service is not installed", () =>
  Effect.gen(function* () {
    const memory = yield* Effect.serviceOption(MemoryService.MemoryService);
    assert.equal(
      yield* memoryNotesFor({ memory, projectId: "p1", prompt: "x", providerTurnOrdinal: 1 }),
      null,
    );
  }),
);

it("hands Codex a separate untrusted entry and prefixes every other driver", () => {
  const message = { text: "faça X", attachments: [] };
  const notes = "<project_notes>…</project_notes>";
  const codex = withMemoryNotes({ driver: "codex", message, notes });
  assert.equal(codex.message.text, "faça X");
  assert.equal(codex.appContext[0]?.text, notes);
  const claude = withMemoryNotes({ driver: "claudeAgent", message, notes });
  assert.equal(claude.message.text, `${notes}\n\nfaça X`);
  assert.deepEqual(claude.appContext, []);
});

it("leaves native slash commands first", () => {
  const message = { text: "/compact", attachments: [] };
  const result = withMemoryNotes({ driver: "claudeAgent", message, notes: "<project_notes/>" });
  assert.equal(result.message.text, "/compact");
});

it.effect(
  "a note saved from a Claude thread reaches a new Codex or OpenCode thread, not another project",
  () =>
    Effect.gen(function* () {
      const service = yield* MemoryService.MemoryService;
      const memory = yield* Effect.serviceOption(MemoryService.MemoryService);
      yield* service.write({
        projectId: "p1",
        kind: "gotcha",
        title: "Fila travada",
        body: "Reiniciar o worker quando a fila travar",
        origin: "agent",
        sourceProvider: "claudeAgent",
      });
      const notes = yield* memoryNotesFor({
        memory,
        projectId: "p1",
        prompt: "a fila travou de novo",
        providerTurnOrdinal: 1,
      });
      const message = { text: "investigue", attachments: [] };
      const codex = withMemoryNotes({ driver: "codex", message, notes });
      const opencode = withMemoryNotes({ driver: "opencode", message, notes });
      assert.ok(codex.appContext[0]?.text.includes("Fila travada"));
      assert.ok(opencode.message.text.includes("Fila travada"));
      const elsewhere = yield* memoryNotesFor({
        memory,
        projectId: "p2",
        prompt: "a fila travou de novo",
        providerTurnOrdinal: 1,
      });
      assert.equal(elsewhere, null);
    }).pipe(Effect.provide(layer)),
);
