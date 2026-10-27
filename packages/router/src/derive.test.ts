import { describe, expect, it } from "vite-plus/test";
import { deriveProfile, slugify } from "./derive.ts";

describe("deriveProfile", () => {
  it("derives slug, stack and description from the project folder", () => {
    const profile = deriveProfile({
      id: "p1",
      title: "Sistema da Clínica",
      workspaceRoot: "/home/user/src/sistema-da-clinica",
      entries: ["Gemfile", "app", "bin/rails", "package.json"],
      readme: "# Clínica\n\n![badge](x)\nGestão de atendimentos\ne prontuários.\n",
      agentsDoc: null,
    });
    expect(profile).toMatchObject({
      slug: "sistema-da-clinica",
      stack: ["Ruby", "Rails", "Node"],
      description: "Gestão de atendimentos e prontuários.",
    });
  });

  it("falls back to the id when the title has no slug characters", () => {
    expect(
      deriveProfile({
        id: "p2",
        title: "***",
        workspaceRoot: "/tmp/p2",
        entries: [],
        readme: null,
        agentsDoc: null,
      }).slug,
    ).toBe("p2");
    expect(slugify("Ação  Ré/Tempersul")).toBe("acao-re-tempersul");
  });

  it("keeps a recognizable folder name as a keyword, dropping generic path segments", () => {
    const profile = deriveProfile({
      id: "p3",
      title: "dev",
      workspaceRoot: "/home/neto/src/devaron/adenta/dev",
      entries: [],
      readme: null,
      agentsDoc: null,
    });
    expect(profile.keywords).toEqual(["neto", "devaron", "adenta"]);
  });

  it("picks up the project's name from its agent doc heading", () => {
    const profile = deriveProfile({
      id: "p4",
      title: "dev",
      workspaceRoot: "/home/user/src/client/nashia/dev",
      entries: [],
      readme: null,
      agentsDoc: "# Nashia\n\nInternal tooling for the Nashia account.\n",
    });
    expect(profile.keywords).toEqual(["client", "nashia", "Nashia"]);
  });

  it("ignores an agent doc heading that is just the file name", () => {
    const profile = deriveProfile({
      id: "p5",
      title: "dev",
      workspaceRoot: "/xx/yy",
      entries: [],
      readme: null,
      agentsDoc: "# CLAUDE.md\n\nGuidance.\n",
    });
    expect(profile.keywords).toEqual(["xx", "yy"]);
  });
});
