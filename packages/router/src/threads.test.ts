import { describe, expect, it } from "vite-plus/test";
import { chooseThread, threadCoherence, type LiveThread } from "./threads.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const thread = (patch: Partial<LiveThread> & { readonly id: string }): LiveThread => ({
  title: "",
  recentText: "",
  touchedFiles: [],
  status: "idle",
  usedTokens: null,
  maxTokens: null,
  lastActivityAt: NOW - 60_000,
  ...patch,
});

const login = thread({
  id: "login",
  title: "Login com 2FA",
  recentText: "ajustando o formulário de login e o controller de autenticação",
  touchedFiles: ["app/AuthController.php", "views/login.blade.php"],
});
const reports = thread({
  id: "reports",
  title: "Relatórios",
  recentText: "exportação de relatórios mensais em CSV",
  touchedFiles: ["app/ReportController.php"],
});

const choose = (
  prompt: string,
  threads: ReadonlyArray<LiveThread>,
  candidateFiles: ReadonlyArray<string> = [],
) => chooseThread({ prompt, candidateFiles, threads, now: NOW });

describe("chooseThread", () => {
  it("sends the request to the idle thread that covers the topic", () => {
    expect(choose("corrija o formulário de login", [login, reports])).toMatchObject({
      action: "send",
      threadId: "login",
    });
  });

  it("uses touched files as a signal when the words differ", () => {
    expect(
      choose("troque o texto do botão", [login, reports], ["views/login.blade.php"]),
    ).toMatchObject({ threadId: "login" });
  });

  it("queues behind a busy thread instead of interrupting it", () => {
    expect(
      choose("corrija o formulário de login", [{ ...login, status: "running" }, reports]),
    ).toMatchObject({ action: "queue", threadId: "login" });
  });

  it("starts a new thread when the topic changed", () => {
    expect(choose("configure o certificado do servidor", [login, reports])).toMatchObject({
      action: "new",
    });
  });

  it("starts a new thread with a handoff when the context is over 60%", () => {
    const full = { ...login, usedTokens: 130_000, maxTokens: 200_000 };
    expect(choose("corrija o formulário de login", [full])).toMatchObject({
      action: "new_with_handoff",
      threadId: "login",
    });
  });

  it("ignores the limit when the provider does not report a maximum", () => {
    const unknown = { ...login, usedTokens: 900_000, maxTokens: null };
    expect(choose("corrija o formulário de login", [unknown])).toMatchObject({ action: "send" });
  });

  it("stops considering idle threads after 14 days, but not busy ones", () => {
    const old = { ...login, lastActivityAt: NOW - 15 * DAY };
    expect(choose("corrija o formulário de login", [old])).toMatchObject({ action: "new" });
    expect(choose("formulário de login", [{ ...old, status: "running" }])).toMatchObject({
      action: "queue",
    });
  });

  it("starts a main thread when the project has none", () => {
    expect(choose("qualquer coisa", [])).toMatchObject({ action: "new" });
  });
});

describe("threadCoherence", () => {
  it("falls as the thread goes quiet", () => {
    const input = { prompt: "formulário de login", candidateFiles: [], now: NOW };
    const fresh = threadCoherence({ ...input, thread: login });
    const stale = threadCoherence({
      ...input,
      thread: { ...login, lastActivityAt: NOW - 20 * DAY },
    });
    expect(stale).toBeLessThan(fresh);
  });
});
