import { describe, expect, it } from "vite-plus/test";
import { deriveProfile, slugify } from "./derive.ts";

describe("deriveProfile", () => {
  it("derives slug, stack and description from the project folder", () => {
    const profile = deriveProfile({
      id: "p1",
      title: "Sistema da Clínica",
      entries: ["Gemfile", "app", "bin/rails", "package.json"],
      readme: "# Clínica\n\n![badge](x)\nGestão de atendimentos\ne prontuários.\n",
    });
    expect(profile).toMatchObject({
      slug: "sistema-da-clinica",
      stack: ["Ruby", "Rails", "Node"],
      description: "Gestão de atendimentos e prontuários.",
    });
  });

  it("falls back to the id when the title has no slug characters", () => {
    expect(deriveProfile({ id: "p2", title: "***", entries: [], readme: null }).slug).toBe("p2");
    expect(slugify("Ação  Ré/Tempersul")).toBe("acao-re-tempersul");
  });
});
