import { describe, expect, it } from "vite-plus/test";
import { MAX_SEED_ITEMS_PER_FILE, seedCandidates } from "./seed.ts";

const doc = `# Projeto

## Comandos
- Rode os testes com \`rtk vitest run\` antes de commitar
- curto

## Convenções
- Use **TypeScript estrito** e nunca \`any\` em código novo
1. Prefixe todo comando shell com rtk sempre que possível

\`\`\`bash
- isto está num bloco de código e deve ser ignorado
\`\`\`

## Acesso
- DB_PASSWORD=hunter2hunter2 fica no cofre da equipe
`;

describe("seedCandidates", () => {
  it("keeps list items with their section as context and a kind from the heading", () => {
    const candidates = seedCandidates(doc);
    expect(candidates.map((candidate) => [candidate.kind, candidate.title])).toEqual([
      ["command", "Rode os testes com rtk vitest run antes de commitar"],
      ["convention", "Use TypeScript estrito e nunca any em código novo"],
      ["convention", "Prefixe todo comando shell com rtk sempre que possível"],
    ]);
    expect(candidates[0]?.body).toBe(
      "Comandos: Rode os testes com rtk vitest run antes de commitar",
    );
  });

  it("drops short items, code blocks and credentials", () => {
    const titles = seedCandidates(doc).map((candidate) => candidate.title);
    expect(titles.join("\n")).not.toContain("curto");
    expect(titles.join("\n")).not.toContain("bloco de código");
    expect(titles.join("\n")).not.toContain("hunter2");
  });

  it("caps the number of proposals per file", () => {
    const many = Array.from(
      { length: 100 },
      (_, index) => `- item numero ${index} com texto suficiente`,
    ).join("\n");
    expect(seedCandidates(many)).toHaveLength(MAX_SEED_ITEMS_PER_FILE);
  });
});
