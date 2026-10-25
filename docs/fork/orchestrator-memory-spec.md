# Spec: Orquestrador multi-projeto com memória compartilhada (fork do T3 Code)

Oct 25, 2026 · @Aécio F. Neto

## 1. Resumo e objetivos

Fork do T3 Code que adiciona dois recursos: um compositor global, que escolhe o projeto a partir do texto do prompt, e uma memória de projeto neutra de provedor, escrita automaticamente pelo servidor. Tudo roda local, sobre os CLIs de agente que o usuário já tem (Claude Code, Codex, OpenCode etc.).

**Problema hoje**

- O fluxo do T3 exige escolher o projeto e a thread antes de pedir algo.
- Cada CLI guarda a própria memória (`CLAUDE.md`, `AGENTS.md`). Ao trocar de agente ou abrir thread nova, o aprendizado se perde.
- A discussão aberta no upstream sobre memória neutra deixa fora de escopo a injeção automática no prompt.

**Objetivos**

| ID  | Objetivo                                                                                                                                                           | Medida de sucesso                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| G1  | Digitar "adicione login no copiador" (ou sem citar o projeto) e o pedido ir para a thread viva do projeto certo, já em branch atual ou worktree conforme o impacto | Acerto top-1 de roteamento ≥ 90% num conjunto de teste do próprio usuário          |
| G2  | Roteamento barato e rápido, com fallback sem LLM                                                                                                                   | p50 < 300 ms no caminho léxico; p95 < 3 s com LLM                                  |
| G3  | Memória por projeto compartilhada entre todos os provedores                                                                                                        | Fato gravado numa thread do Claude aparece no contexto de uma thread nova do Codex |
| G4  | Escrita automática, sem o usuário pedir                                                                                                                            | ≥ 70% das threads com mudanças geram ao menos uma memória útil (revisão manual)    |
| G5  | Execução local e controle total do usuário                                                                                                                         | Dados em disco local, sem telemetria, tudo visível, editável e apagável na UI      |

**Não-objetivos**

- Treinar ou hospedar modelo próprio.
- Memória global entre pessoas, sincronização em nuvem ou multiusuário.
- Busca semântica com embeddings na primeira versão (fica como opcional).
- Substituir `AGENTS.md`/`CLAUDE.md`; a memória os complementa e pode espelhá-los.

## 2. Contexto: o T3 Code hoje

O T3 Code não tem modelo próprio. É um servidor local com interface web e desktop que dirige os CLIs de agente já instalados e autenticados. Os pontos abaixo vêm de páginas públicas e de snippets de discussões do repositório; **devem ser confirmados no código na Fase 0**, pois o projeto muda rápido.

| Peça                                                                 | O que faz                                                                                      | Como usamos                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Servidor (Node/Bun, TypeScript, Effect)                              | Núcleo; clientes web e desktop falam com ele por WebSocket                                     | Hospeda os módulos novos (router e memory)           |
| Orchestration Engine                                                 | Normaliza os eventos de todos os provedores (mudança de arquivo, comando, pedido de aprovação) | Fonte única para a extração automática de memória    |
| Provider Registry e adapters                                         | Um adapter por agente (Codex via JSON-RPC em stdio, Claude via Agent SDK, Cursor, OpenCode)    | Criação da thread no provedor escolhido pelo router  |
| Servidor MCP `t3-code` (em `/mcp`)                                   | Mesmas ferramentas expostas a todos os provedores                                              | Novas ferramentas `memory_*` e `project_*`           |
| Injeção de instruções (`provider-core`, `orchestrationInstructions`) | Já injeta instruções do T3 nas threads quando as ferramentas MCP estão presentes               | Entrega das memórias recuperadas no início da thread |
| Threads, projetos, worktrees, plan mode                              | Sessão isolada por thread; worktree por tarefa; PR pela interface                              | Reaproveitados sem mudança                           |

**Lacunas que a spec cobre**

- Não há campo único de comando: o projeto é escolhido na lista.
- Não há memória persistente neutra de provedor (proposta existe como discussão, sem decisão).
- A injeção de instruções existente não é configurável pelo usuário.

**Fontes consultadas** (snippets de busca, não leitura integral do repositório)

- [T3 Code: An Open-Source GUI for Managing AI Coding Agents (Better Stack)](https://betterstack.com/community/guides/ai/t3-code/)
- [T3 Code: A Minimal Web GUI for Coding Agents (PyShine)](https://pyshine.com/T3Code-Minimal-Web-GUI-Coding-Agents/)
- [Discussão: project memory que agentes escrevem e consultam (t3code #15858)](https://github.com/pingdotgg/t3code/discussions/15858)
- [Discussão: instruções por modelo (t3code #21259)](https://github.com/pingdotgg/t3code/discussions/21259)

### 2.1 Resultado da análise do repositório

Repositório `pingdotgg/t3code`, commit `5b354026` (2026-10-25), lido em disco. **O T3 não tem memória persistente de projeto.** As ocorrências de "memory" no código são telemetria de RAM, caches e o stash do compositor. Há, porém, mecanismos de contexto que cobrem parte do problema:

| Recurso                  | Onde                                                                                                                   | O que faz                                                                                                                                                                                                                                                        | Limite para este projeto                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Handoff de contexto      | `ContextHandoffService`; docs `context-handoffs.md`, `provider-switching-and-context.md`                               | Ao trocar de provedor, retomar ou fazer fork, entrega um resumo textual do histórico da mesma thread (só o delta desde a última participação do provedor). Itens truncados em 240 caracteres; teto inicial de 16.000 tokens (`T3CODE_CONTEXT_HANDOFF_TOKEN_CAP`) | Vale dentro de uma thread ou fork. Não atravessa threads nem sobrevive a uma thread nova            |
| Linhagem de threads      | `thread-lineage-and-context-transfer.md`                                                                               | Fork, merge-back e subagentes com transferência de contexto                                                                                                                                                                                                      | Mesmo limite: relação entre threads ligadas, não memória do projeto                                 |
| MCP de orquestração      | `mcp/toolkits/orchestrator`; `t3_thread_list`, `t3_thread_read`, `t3_thread_launch`, `delegate_task`, `create_threads` | O agente lista e lê qualquer thread do projeto e lança threads novas                                                                                                                                                                                             | Sem memória estruturada: achar um fato exige ler threads inteiras                                   |
| Busca de mensagens       | `ThreadSearch.ts`; migração `069_ThreadMessageSearch`                                                                  | Índice FTS5 (trigramas) das mensagens finalizadas                                                                                                                                                                                                                | Serve a UI e à busca de threads; padrão reaproveitável para o índice da memória                     |
| Injeção de instruções    | `packages/provider-core/src/server/orchestrationInstructions.ts`                                                       | Seções de texto por provedor quando o MCP do T3 está presente (developer instructions do Codex, adapter do Claude, prefixo no ACP, Cursor, OpenCode, Pi)                                                                                                         | Estático e igual para todos os projetos; cada seção ≤ 4.000 bytes porque o Codex trunca acima disso |
| Compactação ociosa       | `IdleCompactionService`                                                                                                | Manda `/compact` no Claude antes de o cache expirar                                                                                                                                                                                                              | Beta, timers só em memória (reinício perde). É compactação, não memória                             |
| Scanner de sessões       | `project/AgentSessionScanner.ts`                                                                                       | Descobre transcritos locais de Claude e Codex para importar                                                                                                                                                                                                      | Base para gerar memória retroativa                                                                  |
| Agentes externos via MCP | `docs/user/outside-agents.md`                                                                                          | Claude Code ou Codex no terminal se conectam ao `/mcp` do T3 com login e permissões                                                                                                                                                                              | As ferramentas `memory_*` ficam disponíveis a CLIs fora do T3 sem servidor standalone               |

**O que isso muda na spec**

- **Pontos de extensão confirmados:** toolkits MCP em `mcp/toolkits/<nome>/{tools,handlers}.ts`; `McpSessionRegistry` com credencial por thread e por capacidade (`preview`, `orchestration`), onde entra uma capacidade `memory`; migrações SQLite numeradas em `persistence/Migrations` (última: 069).
- **Extração em segundo plano:** seguir o padrão de reactors com `EffectWorker` e `EffectOutbox` (`PullRequestSyncReactor`, `DelegatedTaskQuestionReactor`), que não perde trabalho no reinício, ao contrário do `IdleCompactionService`.
- **Nomes reais:** o "Orchestration Engine" desta spec é o `OrchestratorV2` com `EventStore` e `ProjectionStore`; os adapters ficam em `ProviderAdapterRegistry` e `orchestration-v2/Adapters`; criação de thread em `ThreadLaunchService`.
- **Orçamento de injeção em bytes:** memória entra como uma ou duas seções de até 3.500 bytes cada. No ACP a instrução só é injetada no primeiro prompt e quando mudam o modo ou o MCP; a memória entra nesse ponto.
- **Sem duplicar o handoff:** o handoff cuida da continuidade dentro da thread; a memória cobre o que passa de uma thread para outra e não repete o conteúdo do handoff.
- **Filosofia do upstream** (`AGENTS.md`): mínimo, desempenho, pronto para remoto e multi-superfície (web, desktop, mobile). Um recurso desse tamanho tem pouca chance de entrar no upstream, o que reforça o fork com módulos opcionais, sem dados pesados no WebSocket.
- **Roteador (confirmado na Fase 0):** `t3_thread_launch` (toolkit `project`, `mcp/toolkits/project/tools.ts`) já aceita `projectId`, `workspaceStrategy` (`root`, `worktree`, `existing_worktree`), `modelSelection` e `message`. O router só chama esse caminho; não há mudança no ponto de contato.
- **Toolkit de projeto já existe:** `t3_project_list`, `read`, `create`, `update`, `delete` e `clone`. O perfil do router (aliases, keywords, `default_provider`, `worktree_policy`) estende esse toolkit; não se criam `projects_list` nem `project_info`.
- **Sinais da thread viva (confirmado na Fase 0):** o uso de contexto existe por turno (`OrchestrationV2ProviderTurnTokenUsage`: `usedTokens`, `maxTokens` opcional e possivelmente nulo). Arquivos tocados vêm dos eventos de turno (`changes[]` com `path` e `operation`); a agregação por thread é trabalho novo. A fila de follow-up já é modelada (`dispatchMode`: `queue_after_active`, `steer_active`, `restart_active`; `queuePosition`; comandos `queued-run.*`; capacidades `supportsQueuedMessages` e `supportsActiveSteering` por adapter).
- **Injeção por adapter (confirmado na Fase 0):** as instruções do T3 são constantes estáticas, e cada adapter as entrega de um jeito (tabela em 5.4). Existe um canal dinâmico: `appContext` (`mcpAppModelContext.forThread`, `RunExecutionService.ts`), que o Codex entrega por turno como entrada `untrusted`; e o `ContextHandoffDelivery`, que já injeta texto com orçamento e controle de "já entregue".
- **Banco:** o T3 usa migrações numeradas em `persistence/Migrations` (última: 069) e guarda o estado em `T3 home/userdata`. A decisão sobre arquivo próprio ou tabelas no `statev2.sqlite` está na questão aberta 2.

## 3. Arquitetura proposta

Dois módulos novos no servidor do T3 (router e memória) e ferramentas novas no servidor MCP que já existe. Os agentes não mudam: a thread viva mantém o contexto do projeto; threads novas recebem memória na criação, e todos consultam a memória pelas ferramentas MCP.

```text
Clientes (web, desktop; mobile via servidor)
   compositor global [novo] · painel de memória [novo] · configurações
        │ WebSocket (comandos e eventos tipados em packages/contracts)
Servidor do T3
   router [novo] ──► ThreadLaunchService (t3_thread_launch)
   memória [novo] ◄── fluxo de eventos (OrchestratorV2 / EventStore)
   toolkit MCP t3_memory_* [novo] · t3_project_* [estendido]
   reactor de extração [novo] (EffectWorker + EffectOutbox)
        │ adapters (ProviderAdapterRegistry)
Provedores: Codex · Claude · Cursor · OpenCode · ACP · Pi
Dados locais: statev2.sqlite (existente) · memory.db [novo]
```

O que está em destaque é novo ou alterado: o compositor, o router, a memória, as ferramentas MCP e os dados locais. O restante já existe no T3.

**Fluxo de uma tarefa**

1. O compositor envia o prompt; o router escolhe o projeto, a thread viva e o workspace, branch atual ou worktree (seção 4).
2. O servidor envia o pedido à thread viva escolhida; sem thread viva coerente, cria uma thread nova no workspace planejado e injeta as memórias do projeto (seção 5.4).
3. O agente trabalha e pode chamar `memory_recall` e `memory_write`.
4. O Orchestration Engine normaliza os eventos; o módulo de memória extrai e grava em segundo plano (seção 5.2).
5. As threads vivas seguem com o contexto próprio; threads novas, em qualquer provedor, começam com as memórias atualizadas.

**Decisões de arquitetura**

- Tudo no processo do servidor do T3: sem serviço extra e sem rede além da já existente.
- SQLite embutido, em pacote próprio com migrações próprias.
- Chamadas a modelo atrás de uma interface única (`ModelClient`) com implementações para CLI já autenticado e para Ollama; o router e o extrator não sabem qual está em uso.
- Router e memória desligáveis por configuração, sem efeito no restante do T3.

## 4. Roteador e planejador de execução

O router recebe o texto do prompt e decide três coisas: o projeto, a thread viva que atende o pedido e o workspace (branch atual ou worktree). Funciona em camadas, da mais barata à mais cara, e nunca age sem confirmação quando a confiança é baixa.

### 4.1 Registro de projetos

| Campo                        | Tipo           | Descrição                                                               |
| ---------------------------- | -------------- | ----------------------------------------------------------------------- |
| `id`, `slug`                 | string         | Identificador estável e nome curto (`copiador`)                         |
| `path`                       | string         | Caminho absoluto do repositório                                         |
| `name`, `aliases[]`          | string\[\]     | Nomes pelos quais o usuário chama o projeto ("copy trading", "clínica") |
| `description`                | string         | Uma ou duas frases sobre o que o projeto é                              |
| `stack[]`, `keywords[]`      | string\[\]     | Tecnologias e termos de domínio ("MT5", "licitação", "Rails")           |
| `default_provider`           | enum           | Agente padrão do projeto                                                |
| `worktree_policy`            | enum           | `never`, `ask`, `always`                                                |
| `archived`, `last_active_at` | bool, datetime | Controle de ruído e recência                                            |

**Identidade do projeto:** a chave de escopo da memória e do router é o `project_id` do T3, não o caminho. Quando vários projetos do T3 apontam para o mesmo repositório (monorepo, worktrees), a memória pertence ao projeto escolhido; worktrees do mesmo projeto compartilham a memória dele. Um monorepo com subprojetos distintos deve ser registrado como projetos separados, com `path` de subpasta e aliases próprios.

**Descoberta automática:** o usuário configura pastas-raiz; o servidor varre repositórios Git e preenche `description`, `stack` e `keywords` a partir de `README`, `AGENTS.md`, `package.json`, `composer.json` e `Gemfile`. O usuário revisa e corrige na UI.

### 4.2 Pipeline de decisão

1. **Menção explícita:** `@slug`, "no projeto X", "em X:" ou alias exato. Resolve de forma determinística, confiança 1,0.
2. **Pontuação léxica (BM25):** o prompt contra o perfil de cada projeto (nome, aliases, descrição, keywords, stack, títulos de threads recentes, títulos de memórias). Gera os 5 melhores candidatos.
3. **Aceite direto:** se o melhor candidato tem pontuação normalizada ≥ 0,8 e margem ≥ 0,25 sobre o segundo, roteia sem LLM.
4. **Classificador LLM:** com os candidatos e seus perfis curtos, devolve JSON `{project, confidence, reason, alternatives[]}`. Modelo configurável (Haiku via CLI já autenticado, ou modelo local via Ollama). Se o modelo falhar ou estourar o tempo (5 s), o resultado do passo 2 é usado.
5. **Política de decisão** (limiares configuráveis):

| Confiança   | Comportamento                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 0,85      | Com `router.auto_start = true`: roteia e inicia a thread; mostra o chip "→ projeto" com opção de trocar nos primeiros segundos. Com `auto_start = false` (padrão até o G1): trata como a faixa seguinte e mostra o cartão de confirmação |
| 0,50 a 0,85 | Mostra cartão de confirmação com os 3 melhores candidatos; nada inicia antes da escolha                                                                                                                                                  |
| < 0,50      | Pergunta: lista de projetos, ou "é um projeto novo?"                                                                                                                                                                                     |

**Casos especiais**

- **Prompt com vários projetos** ("ajuste o login no X e no Y"): o router detecta, para na faixa "pergunta" e deixa o usuário escolher um projeto ou reenviar em pedidos separados. Dividir em N threads fica fora da v1.
- **Sem projeto** (pergunta geral): oferece thread avulsa sem diretório de projeto.
- **Continuação:** se o prompt é resposta a uma thread aberta (mesma sessão da UI), mantém o projeto da thread.

### 4.3 Escolha da thread viva e criação de thread nova

Cada projeto pode ter **threads vivas**: threads persistentes do T3 que já têm contexto acumulado do agente, cada uma ligada a um workspace (a raiz com a branch atual, ou um worktree). O termo não se refere a janelas do aplicativo no desktop. Reaproveitar uma thread viva evita a partida a frio e é o caminho padrão.

**Estado de cada thread viva** (derivado do que o T3 já guarda): `thread_id`, projeto, workspace (raiz e branch, ou caminho do worktree), provedor, estado (`idle`, `running`, `waiting_approval`), tópico (título e últimas mensagens), arquivos tocados recentemente, uso estimado de contexto e `last_activity_at`.

**Coerência do pedido com cada thread viva** (calculada sem LLM): BM25 do pedido contra o tópico e os arquivos tocados, mais a sobreposição entre os arquivos candidatos do pedido (seção 4.4) e os já tocados pela thread, mais um peso de recência.

| Situação                                         | Decisão                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Thread viva ociosa e coerente                    | Envia o pedido a ela                                                                                             |
| Thread viva coerente, mas ocupada                | Enfileira como follow-up. Steering só se o usuário pedir; "nova thread" fica visível no chip                     |
| Nenhuma thread viva coerente, ou o assunto mudou | Thread nova no workspace planejado em 4.4; recebe a memória do projeto (seção 5.4)                               |
| Contexto da thread acima de 60% da capacidade    | Thread nova com handoff e memória, em vez de empurrar mais contexto                                              |
| Projeto sem thread viva                          | Cria a thread principal no workspace planejado                                                                   |
| Plano em worktree (4.4)                          | Thread nova, porque o checkout é novo; a continuação da mesma feature reutiliza o worktree (`existing_worktree`) |

Os 60% e os limiares de coerência são valores iniciais, a calibrar. **Higiene:** threads vivas ociosas há mais de 14 dias deixam de ser candidatas do router (valor inicial); a thread não é arquivada nem alterada no T3; a thread de um worktree vive até o merge ou o descarte do PR. Uma thread única com tarefas sem relação degrada as respostas; por isso uma mudança de assunto abre thread nova em vez de reutilizar a thread.

### 4.4 Planejador de workspace: branch atual ou worktree

Hoje o usuário escolhe isso no T3 a cada thread. O orquestrador passa a recomendar e, conforme a configuração, a decidir sozinho: **feature nova prefere worktree; correção simples prefere a branch atual.** O usuário sempre pode trocar.

**Sinais**

1. **Natureza do pedido:** feature, refatoração, migração, correção, ajuste de texto ou estilo, investigação (só leitura). Primeiro por palavras-chave ("adicione", "crie", "implemente" contra "corrija", "erro", "ajuste"); o LLM decide os casos duvidosos.
2. **Impacto estimado no código:** lista de arquivos candidatos a partir dos termos e símbolos do pedido (índice de busca do workspace do T3 e `ripgrep`), com contagem de arquivos e diretórios, camadas atravessadas (rotas, controllers, models, views, testes), migrações de banco e mudanças de dependências (`package.json`, `composer.json`, `Gemfile`). Opcionalmente o LLM refina a estimativa a partir da árvore do projeto e do `AGENTS.md`. Nada é executado nem editado nessa etapa.
3. **Estado do checkout:** alterações não commitadas, branch principal ou protegida, PR aberto na branch, outras threads ocupadas no mesmo checkout.
4. **Sobreposição:** arquivos candidatos em comum com os que outra thread ativa já alterou.

**Tabela de decisão** (limiares iniciais, a calibrar com o conjunto de teste)

| Situação                                                                                         | Workspace                                             |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Feature nova, ou estimativa > 5 arquivos, ou ≥ 3 camadas, ou migração ou mudança de dependências | Worktree, com branch nova a partir da base do projeto |
| Correção pequena: ≤ 3 arquivos, uma camada, sem migração                                         | Branch atual                                          |
| Branch atual é a principal ou protegida e o pedido altera código                                 | Worktree (evita commitar na principal)                |
| Checkout com alterações não commitadas, ou outra thread ocupada tocando os mesmos arquivos       | Worktree (isolamento)                                 |
| Continuação de uma feature que já tem worktree                                                   | Reaproveita o worktree existente                      |
| Pergunta ou investigação (só leitura)                                                            | Branch atual, sem checkout novo                       |
| Fronteira (por exemplo 4 a 5 arquivos)                                                           | Pergunta ao usuário, com a recomendação marcada       |

**Saída:** `{workspace: current|worktree|existing_worktree, reason, impact: {files_est, layers[], touches_migrations, touches_deps}, confidence}`. A política de confiança da seção 4.2 vale aqui também (automático, confirmar, perguntar). O chip mostra o plano e o motivo ("→ copiador · worktree · feature, \~12 arquivos"), com troca em um clique.

**Execução:** usa as estratégias que o T3 já oferece no lançamento de thread: `root` (branch atual), `worktree` (com `baseRef`) e `existing_worktree`. O nome da branch do worktree segue as regras de configuração do T3. Configuração: `router.workspace_mode = auto | ask | manual`; `manual` mantém o comportamento atual do T3.

**Aprendizado:** cada troca manual de workspace grava o caso (pedido, impacto estimado, escolha do usuário) na tabela `workspace_feedback`. Os limiares não se ajustam sozinhos: o usuário os altera na configuração a partir da taxa de concordância medida. A taxa de concordância com o usuário é um critério de aceite (seção 10).

### 4.5 Aprendizado com correções de projeto

Toda troca manual de projeto grava um par (prompt, projeto correto) em `routing_feedback`. Esses exemplos entram como few-shot no classificador LLM (os 5 mais parecidos). Os pesos das keywords e os limiares não se ajustam sozinhos na v1. Meta: a taxa de correção cair ao longo do uso.

### 4.6 Prompt do classificador de projeto (rascunho)

```text
Você escolhe em qual projeto uma tarefa de programação deve ser executada.
Projetos (slug: descrição; stack; palavras-chave):
{lista dos 5 candidatos}
Exemplos de correções anteriores:
{até 5 pares prompt -> slug}
Tarefa: {prompt}
Responda apenas JSON: {"project":"slug|null","confidence":0-1,"reason":"...","alternatives":["slug"]}
Se nenhum projeto se encaixa, use null.
```

## 5. Memória compartilhada (camada de apoio)

Neste modelo a memória é uma camada de apoio: a thread viva já carrega o contexto do que está em andamento, e a memória cobre o que a thread não tem (thread nova, troca de provedor, reinício ou compactação) e os fatos que valem para o projeto inteiro. Ela fica no servidor do T3, não em arquivos de um CLI. Por isso qualquer provedor escreve nela e lê dela do mesmo jeito. A escrita é automática e feita pelo servidor a partir do fluxo normalizado de eventos, sem depender de hooks de cada CLI.

### 5.1 Armazenamento

Um arquivo SQLite local (`<T3 home>/userdata/memory.db`, permissão 600) com FTS5 para busca textual.

| Tabela               | Campos principais                                                                                                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`           | `id`, `scope` (`project` ou `global`), `project_id`, `kind`, `title`, `body`, `tags`, `status`, `confidence`, `pinned`, `source_thread_id`, `source_provider`, `origin` (`auto` ou `agent` ou `user`), `supersedes_id`, `content_hash`, `created_at`, `updated_at`, `last_used_at`, `use_count` |
| `memories_fts`       | Índice FTS5 sobre `title`, `body`, `tags`                                                                                                                                                                                                                                                       |
| `thread_summaries`   | `thread_id`, `project_id`, `summary`, `files_touched`, `outcome`, `created_at`                                                                                                                                                                                                                  |
| `memory_events`      | Log de auditoria: criação, edição, fusão, substituição, exclusão, uso                                                                                                                                                                                                                           |
| `routing_feedback`   | Pares (prompt, projeto correto) da seção 4.5                                                                                                                                                                                                                                                    |
| `workspace_feedback` | Casos da seção 4.4: pedido, impacto estimado, workspace recomendado e escolha do usuário                                                                                                                                                                                                        |

**Tipos (`kind`):** `decision`, `convention`, `architecture`, `command`, `gotcha`, `preference`, `todo`. **Estados (`status`):** `active`, `pending_review`, `superseded`, `archived`.

### 5.2 Escrita automática

**Gatilhos (v1):** fim de turno com mudanças de arquivo e fechamento da thread. Os gatilhos por tempo (ociosa por 10 min, a cada 8 turnos) ficam fora da v1; se entrarem depois, devem ser persistidos no `EffectOutbox`.

1. **Coleta:** o servidor monta um resumo compacto do período: mensagens do usuário, resposta final do agente, comandos executados, arquivos alterados (só caminhos e estatística do diff), erros e resultado.
2. **Redação de segredos:** regex e entropia removem tokens, chaves, senhas e conteúdo de `.env` antes de qualquer chamada a modelo.
3. **Extração:** um LLM devolve JSON com `thread_summary` e uma lista de candidatos (`kind`, `title`, `body`, `tags`, `confidence`). O prompt exige fatos duráveis e verificáveis pela conversa; descarta estado transitório ("rodei o teste e passou").
4. **Deduplicação:** compara `content_hash` e similaridade FTS com memórias ativas do projeto. Igual: ignora e incrementa uso. Parecida: funde. Contraditória: nova memória com `supersedes_id`, a antiga vira `superseded`.
5. **Controle:** confiança < 0,6 é descartada; assunto sensível (credenciais, dados pessoais) vai para `pending_review`; o resto entra como `active`. Nas duas primeiras semanas de uso real (`memory.review_first_weeks`), toda memória automática entra como `pending_review` e só depois as de confiança alta passam a entrar como `active`.
6. **Registro:** grava, emite o evento `memory.saved` e atualiza o painel na UI.

O agente também pode gravar durante a thread pela ferramenta `memory_write` (`origin = agent`), sujeita à mesma deduplicação e aos mesmos limites de tamanho.

### 5.3 Manutenção

- Memória não usada por 90 dias e sem pin vai para `archived` (reversível).
- Teto por projeto (padrão 500 ativas); acima disso, as de menor uso e confiança são arquivadas.
- O usuário edita, fixa, apaga ou aprova qualquer item na UI; apagar remove de fato (incluindo FTS).

### 5.4 Recuperação e injeção

**No início de cada thread nova (e ao retomar uma thread após troca de provedor ou reinício)**, o servidor monta um bloco de contexto e o entrega pelo mecanismo de injeção de instruções do T3, igual para todos os provedores.

- **Orçamento:** até 2 seções de 3.500 bytes cada (o Codex trunca entradas acima de 4.000 bytes), configurável. O limite vale por seção, não há teto global.
- **Canal por adapter** (verificado no código):

| Adapter  | Canal                                                                                           | Memória dinâmica        |
| -------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| Codex    | `additionalContext` por turno; memória entra como `untrusted` via `appContext`                  | Sim, por turno          |
| OpenCode | `session.instructions.entry.put`, reenviado quando o texto muda                                 | Sim                     |
| Claude   | `systemPrompt.append`, fixado na criação da sessão                                              | Só ao criar a sessão    |
| ACP      | Prefixo no primeiro prompt ou ao mudar modo/MCP                                                 | Só no primeiro prompt   |
| Pi       | Texto embutido na extensão gerada                                                               | Não, sem rebuild        |
| Cursor   | Prefixo no prompt da primeira execução (`t3OrchestrationPromptForFirstRun`, `runOrdinal === 1`) | Só na primeira execução |

Preferência: entregar pelo `appContext`/`ContextHandoffDelivery` existentes, com um ponto de contato único, e usar o caminho próprio do adapter só onde esse canal não chega. Em Claude, ACP, Cursor e Pi a memória vale do início da sessão em diante; só `memory_recall` atualiza depois.

- **Seleção:** perfil do projeto, memórias fixadas e todas as `convention`; depois as melhores por pontuação combinada de BM25 contra o prompt inicial, recência, uso e peso do `kind`.
- **Formato:** lista curta com id e título, e uma linha final avisando que `memory_recall` busca mais detalhes.
- **Segurança:** o bloco é rotulado como notas de projeto não confiáveis, que não podem alterar permissões nem instruções do usuário.
- **Cache:** não há injeção por prompt a cada turno; recuperação adicional só pela ferramenta `memory_recall`, o que preserva o cache de prompt dos provedores.

### 5.4.1 Memória inicial (semente)

No primeiro uso de um projeto, e sob comando do usuário depois, o servidor pode propor memórias a partir de fontes que já existem: `CLAUDE.md` e `AGENTS.md` do repositório (seções de convenções e comandos) e os transcritos descobertos pelo `AgentSessionScanner` (Claude e Codex). Tudo entra com `origin = auto` e `status = pending_review`, passa pela redação de segredos e pela deduplicação da seção 5.2, e nada é ativado sem aprovação em lote na UI. O padrão é valer só para threads novas; a importação retroativa é opt-in por projeto.

### 5.5 Uso fora do T3

Para CLIs rodando fora do T3 (ou para quem quiser ler no repositório):

- **CLIs fora do T3:** conectam-se ao `/mcp` do servidor do T3 com login e permissões (`docs/user/outside-agents.md`) e usam as ferramentas `t3_memory_*`. O servidor MCP standalone (`t3-memory-mcp`, stdio) fica fora da v1.
- **Espelho opcional** (Fase 5, desligado por padrão; a v1 não escreve em arquivos do repositório): bloco entre marcadores `<!-- t3:memory:start -->` e `<!-- t3:memory:end -->` em `AGENTS.md`, gerado do banco, em uma direção só (banco para arquivo).

## 6. API, ferramentas MCP e eventos

Nomes são propostas; devem seguir as convenções de RPC e de eventos já usadas pelo T3 (confirmar na Fase 0).

### 6.1 Ferramentas MCP (visíveis a todos os provedores)

| Ferramenta      | Entrada                                              | Retorno                                                           |
| --------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `memory_recall` | `query`, `project?`, `kinds?[]`, `limit?` (padrão 8) | Lista de memórias com `id`, `kind`, `title`, `body`, `updated_at` |
| `memory_write`  | `title`, `body`, `kind`, `tags?[]`, `pin?`           | `id` e ação tomada (`created`, `merged`, `superseded`, `skipped`) |
| `memory_update` | `id`, campos a alterar                               | Memória atualizada                                                |
| `memory_forget` | `id`, `reason?`                                      | Confirmação (a exclusão fica no log de auditoria)                 |
| `memory_list`   | `project?`, `kind?`, `status?`, `cursor?`            | Página de memórias                                                |

Perfil e lista de projetos usam o toolkit `t3_project_*` já existente, estendido com os campos da seção 4.1 (não há `project_info` nem `projects_list`). Os nomes finais seguem o prefixo `t3_` (por exemplo `t3_memory_recall`).

`project?` omitido significa o projeto da thread atual. Em threads fora de projeto, `memory_*` opera só no escopo global (se habilitado).

### 6.2 Comandos do servidor (cliente para servidor)

| Grupo        | Comandos                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Router       | `router.classify(prompt)`, `router.confirm(decisionId, project)`, `router.override(threadId, project)`                                      |
| Projetos     | `projects.list`, `projects.register`, `projects.scan(roots)`, `projects.update`, `projects.archive`                                         |
| Memória      | `memory.search`, `memory.list`, `memory.create`, `memory.update`, `memory.delete`, `memory.pin`, `memory.approve`, `memory.export(project)` |
| Configuração | `settings.get`, `settings.update`                                                                                                           |

### 6.3 Eventos (servidor para cliente)

| Evento                                                | Quando                    | Carga                                                                                      |
| ----------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `router.decision`                                     | Após classificar          | `decisionId`, `project`, `confidence`, `alternatives[]`, `mode` (`auto`, `confirm`, `ask`) |
| `router.thread_started`                               | Thread criada pelo router | `threadId`, `project`, `provider`                                                          |
| `memory.injected`                                     | Início da thread          | `threadId`, ids das memórias, tokens usados                                                |
| `memory.extracted`                                    | Fim da extração           | `threadId`, candidatos, ações tomadas                                                      |
| `memory.saved`, `memory.superseded`, `memory.pending` | Mudança no banco          | `id`, `project`, `kind`                                                                    |

### 6.4 Configuração

Arquivo `~/.t3code/config.toml` (também editável na UI):

```toml
[router]
enabled = true
classifier = "lexical-only" # ou "claude-haiku" ou "ollama:qwen2.5:7b" (após a medição da Fase 0)
auto_start = false # true só após o G1
auto_threshold = 0.85
confirm_threshold = 0.50
timeout_ms = 5000
workspace_mode = "ask" # auto, ask ou manual
roots = ["~/projects"]

[memory]
enabled = true
extractor = "off" # ou "claude-haiku" ou "ollama:..." (após a medição da Fase 0)
review_first_weeks = 2 # semanas em que a memória automática entra como pending_review
inject_section_bytes = 3500 # por seção, máximo 2 seções
min_confidence = 0.6
max_active_per_project = 500
archive_after_days = 90
global_scope = false
mirror_agents_md = false
excluded_projects = []
opt_in_only = true # memória só nos projetos marcados
```

## 7. Interface (UI/UX)

A tela inicial passa a ser um compositor global. A lista de projetos continua existindo, mas deixa de ser o ponto de partida obrigatório.

### 7.1 Compositor global

- Campo de prompt na tela inicial, também por atalho global (por exemplo `Cmd/Ctrl+K`).
- Ao enviar, aparece o chip **→ projeto** com thread e workspace (branch atual ou worktree), confiança e o motivo curto ("mencionou licitação, stack Laravel"). Clicar abre a troca de projeto.
- Três estados, conforme a seção 4.2: **automático** (thread já iniciada, com opção de trocar a thread), **confirmação** (cartão com 3 candidatos, nada inicia antes) e **pergunta** (lista de projetos e opção "projeto novo").
- Prompt com vários projetos: cartão de pergunta para escolher um projeto ou reenviar em pedidos separados.
- Opções do envio: provedor, worktree, plan mode, pré-preenchidas pelo projeto.

### 7.2 Threads

- Lista agrupada por projeto, com filtro e busca; indicador de threads em andamento.
- Na abertura da thread, uma linha discreta "N memórias carregadas" que expande para a lista (id, título), com ação para remover uma memória daquela thread.
- Ao final, um resumo "memórias salvas desta thread" com desfazer.

### 7.3 Painel de memória (por projeto)

| Elemento                                                  | Função                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| Lista com filtros por `kind`, `status`, origem e provedor | Navegar e auditar                                          |
| Busca (FTS)                                               | Achar um fato                                              |
| Edição inline, fixar, arquivar, apagar                    | Controle total do usuário                                  |
| Fila de `pending_review`                                  | Aprovar ou rejeitar o que é sensível ou de baixa confiança |
| Histórico de substituições                                | Ver o que foi corrigido e por quê                          |
| Exportar (Markdown) e espelhar em `AGENTS.md`             | Levar a memória para fora do T3                            |

### 7.4 Configurações

- Seção Router: ativar, modelo do classificador, limiares, pastas-raiz, reescanear projetos.
- Seção Memória: ativar, modelo do extrator, orçamento de injeção, escopo global, projetos excluídos, apagar tudo.
- Indicador claro de qual modelo recebe dados (local ou provedor) em cada recurso.

### 7.5 Celular e acesso remoto

O compositor e o painel funcionam no cliente web, portanto também no acesso remoto que o T3 já oferece (`t3 serve`, `t3 pair`).

**Cobertura por superfície (v1):** web e desktop (que embute a web) recebem compositor, chip, painel e configurações. O mobile (React Native, navegação própria) fica fora da v1 para a UI, mas continua usando o roteamento e a memória do servidor pelas threads criadas e pelas ferramentas MCP. Comandos e eventos novos ficam tipados em `packages/contracts`, para que o mobile os adote depois sem mudar o servidor. Em acesso remoto, as operações de memória e de roteamento exigem os mesmos escopos de permissão das demais mutações do cliente.

## 8. Privacidade, segurança e execução local

Todo o armazenamento e a orquestração rodam na máquina do usuário. O único tráfego externo é o que os próprios CLIs de agente já fazem e as chamadas do classificador e do extrator ao modelo configurado.

**Princípios**

- Dados em disco local: `memory.db` e a configuração com permissão 600; sem telemetria nem sincronização.
- Cada recurso mostra qual modelo recebe dados. Com `ollama:*` ou `lexical-only`/`off`, nada sai da máquina além do que o agente já envia.
- Mínimo necessário: o extrator recebe resumo compacto (mensagens, comandos, caminhos de arquivos, estatística de diff), nunca o conteúdo integral de arquivos.
- Controle do usuário: ver, editar, apagar item, apagar projeto, apagar tudo; exclusão real, inclusive no índice FTS.

**Ameaças e controles**

| Ameaça                                                                                      | Controle                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segredos vazando para o modelo ou para a memória                                            | Redação por regex e entropia antes de enviar; memórias com padrão de segredo são rejeitadas; revisão manual para itens sensíveis                                                                                                    |
| Injeção de prompt via conteúdo de arquivo, página ou saída de ferramenta que vira "memória" | O extrator trata o material como dado; instruções detectadas viram `pending_review`; o bloco injetado é rotulado como notas não confiáveis                                                                                          |
| Memória tentando ampliar permissões ou mudar regras de aprovação                            | O bloco de memória não tem efeito sobre aprovações; o servidor ignora qualquer pedido de permissão vindo de memória                                                                                                                 |
| Roteamento errado levando o agente a editar o projeto errado                                | Sem execução na faixa de baixa confiança; chip de troca; aprovações do T3 e worktrees continuam valendo                                                                                                                             |
| Memória envenenada por agente defeituoso                                                    | Origem e provedor gravados; limites de tamanho e taxa por thread; auditoria em `memory_events`; desfazer em lote por thread                                                                                                         |
| Dados de um projeto aparecendo em outro                                                     | Escopo por `project_id` em toda consulta; ferramentas só cruzam projetos se o parâmetro `project` for explícito; projetos podem ser excluídos da memória                                                                            |
| Outro processo do usuário lendo o `memory.db` direto                                        | Arquivo com permissão 600, no T3 home; acesso de CLIs externos só pelo `/mcp` autenticado do T3                                                                                                                                     |
| Dado sensível de cliente (por exemplo saúde) na memória ou no prompt do extrator            | Redação não cobre código proprietário nem dados de negócio; `excluded_projects` e uma opção `memory.opt_in_only = true` (padrão: memória só nos projetos marcados); extrator local (`ollama:*`) recomendado para projetos sensíveis |

O servidor MCP embutido no T3 mantém o modelo de acesso que o T3 já usa (login e permissões). Não há servidor standalone na v1.

## 9. Estratégia de fork e manutenção

O T3 muda rápido, então o fork precisa ser fácil de atualizar. A regra é: código novo em pacotes novos, e poucos pontos de contato com o código do upstream.

**Estrutura**

| Item               | Decisão                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repositório        | Fork com `upstream` configurado; branch `main` do fork rebaseada no upstream toda semana                                                                                                                                 |
| Pacotes novos      | `packages/router` (registro, pontuação, classificador), `packages/memory` (SQLite, extração, recuperação)                                                                                                                |
| Pontos de contato  | (1) assinatura do fluxo de eventos do Orchestration Engine; (2) registro das novas ferramentas no servidor MCP `t3-code`; (3) ponto de injeção de instruções; (4) criação de thread; (5) rotas e componentes novos na UI |
| Feature flags      | `router.enabled` e `memory.enabled`; com as duas desligadas o comportamento é o do T3 original                                                                                                                           |
| Testes de contrato | Um teste por ponto de contato, rodando no CI do fork; quebra no rebase acusa a mudança do upstream                                                                                                                       |
| Banco              | Migrações próprias em arquivo separado, dentro do T3 home (questão aberta 2)                                                                                                                                             |

**Contribuição ao upstream**

A discussão #15858 propõe memória neutra de provedor, opt-in e por projeto, via MCP. O desenho da seção 5 é um superconjunto dessa proposta. Vale participar da discussão e, se houver interesse, oferecer a parte de memória manual (`memory_recall`, `memory_write`, painel) como contribuição, mantendo no fork a escrita automática e o router.

**Licença:** o T3 Code é MIT; o fork mantém o aviso de licença e os créditos.

## 10. Plano de fases, testes e critérios de aceite

Seis fases entregam valor incremental; três gates decidem se o plano segue ou muda (seção 10.1).

### 10.1 Fases e gates

Estimativa de 10 a 13 semanas para uma pessoa (sem base em medição). Cada fase depende da anterior. Os gates são pontos de decisão: se o critério falha, o plano muda antes de seguir.

| Fase                         | Duração                           | Entrega                                                                                                                                                                                                                                                     | Critérios cobertos          |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 0. Verificação e bases       | 1 semana                          | Fork configurado com `upstream`; checagem restante no código (padrão de reactor com `EffectWorker` e `EffectOutbox`); conjuntos dourados (100 prompts, 20 threads); medição de latência da `ModelClient`; decisões da seção 11 confirmadas                  | Pré-requisito de A1, A2, A4 |
| 1. Router de projeto         | 2 a 3 semanas                     | `packages/router`: registro e descoberta de projetos (4.1), menção explícita, BM25, política de confiança, classificador LLM opcional, `routing_feedback`; compositor global, chip e cartões de confirmação (7.1); criação da thread via `t3_thread_launch` | A1, A2                      |
| 2. Memória manual            | 2 semanas                         | `packages/memory`: `memory.db`, FTS5, ferramentas `t3_memory_*`, injeção no início da thread (5.4) pelo canal de cada adapter, painel de memória e configurações, exclusão real                                                                             | A3, A6, A7 (exclusão), A8   |
| 3. Threads vivas e workspace | 2 a 3 semanas                     | Estado das threads vivas, coerência, fila e higiene (4.3); planejador de workspace (4.4) com `workspace_mode = ask`; `workspace_feedback`                                                                                                                   | B1 a B5                     |
| 4. Extração automática       | 2 semanas                         | Reactor com `EffectWorker` e `EffectOutbox`; coleta, redação de segredos, extração, deduplicação, `pending_review`; semente (5.4.1); desfazer por thread                                                                                                    | A4, A5, A7 (segredos)       |
| 5. Acabamento                | 1 a 2 semanas, mais 2 de uso real | Espelho de `AGENTS.md` (5.5); embeddings, se aprovados; ajuste de limiares com o uso; testes de contrato de todos os pontos de contato                                                                                                                      | A8 completo                 |

| Gate | Quando        | Critério para seguir                                                                                                                       |
| ---- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| G1   | Fim da Fase 1 | A1 e A2 atendidos no conjunto dourado. Se o p95 com LLM não fecha, o padrão fica `lexical-only` e o LLM segue opcional                     |
| G2   | Fim da Fase 3 | B1 e B2 atendidos. Só com concordância medida de workspace ≥ 80% o padrão de `workspace_mode` pode passar de `ask` para `auto`             |
| G3   | Fim da Fase 4 | A4 e A5 atendidos. Se mais de 10% das memórias forem erradas, a extração fica desligada por padrão e só `memory_write` do agente permanece |

A Fase 5 só é dada como concluída após duas semanas de uso diário nos projetos reais.

Os losangos marcam os gates; a ordem das fases é sequencial porque cada uma depende do que a anterior entrega.

**Critérios de aceite**

| ID  | Critério                          | Como medir                                                                                                                                        |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Roteamento por menção e por texto | Conjunto de pelo menos 100 prompts reais dos projetos do usuário: acerto top-1 ≥ 90%; nenhuma execução em baixa confiança sem confirmação         |
| A2  | Latência do router                | p50 < 300 ms no caminho léxico; p95 < 3 s com LLM                                                                                                 |
| A3  | Memória entre provedores          | Fato gravado numa thread do Claude aparece numa thread nova do Codex e do OpenCode no mesmo projeto, e não aparece em outro projeto               |
| A4  | Extração automática               | Em 20 threads de teste com mudanças: ≥ 70% geram ao menos uma memória útil; ≤ 10% de memórias erradas na revisão manual                           |
| A5  | Deduplicação e substituição       | Reprocessar a mesma thread não cria duplicadas; fato contraditório substitui o antigo e mantém o histórico                                        |
| A6  | Injeção dentro do limite          | Nenhuma seção > 3.500 bytes; um teste por adapter (Codex, Claude, ACP, Cursor, OpenCode, Pi) confirma que o bloco chega ao agente                 |
| A7  | Privacidade                       | Segredos plantados nos transcritos de teste não aparecem em `memory.db` nem na chamada ao modelo; exclusão remove também do índice FTS            |
| A8  | Isolamento do fork                | Com `router.enabled = false` e `memory.enabled = false`, a suíte do upstream passa sem alteração; testes de contrato dos pontos de contato passam |

**Critérios do modelo de threads vivas e workspace**

| ID  | Critério                | Como medir                                                                                                                                                                               |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Escolha da thread viva  | Em pelo menos 50 pedidos reais com mais de uma thread viva no projeto, a thread escolhida coincide com a que o usuário escolheria em ≥ 85% dos casos                                     |
| B2  | Planejador de workspace | Em pelo menos 50 pedidos reais, concordância com a escolha manual do usuário (branch atual ou worktree) ≥ 80%; nenhuma alteração direta na branch principal ou protegida sem confirmação |
| B3  | Thread ocupada          | O pedido é enfileirado sem perda nem duplicação, e a interface mostra a posição na fila                                                                                                  |
| B4  | Higiene de contexto     | Thread acima do limite de contexto, ou com mudança de assunto, abre thread nova com handoff e memória, e o usuário vê o motivo                                                           |
| B5  | Fallback                | Com `router.workspace_mode = manual`, o fluxo é idêntico ao do T3 original                                                                                                               |

**Estratégia de testes**

- **Unitários:** pontuação BM25, política de confiança, deduplicação, redação de segredos, montagem do bloco de injeção em bytes.
- **Integração:** migração do banco; ferramentas MCP por HTTP com credencial; reactor de extração com `EffectWorker`, incluindo reinício no meio do processamento (a fila deve retomar).
- **Provedores:** usar os testkits de adapter já existentes (`ProviderTurnStartService.testkit.ts`, `*.testkit.ts`) para simular threads de vários provedores sem rodar os CLIs.
- **Avaliação offline:** conjunto dourado de roteamento (prompts rotulados) e de extração (threads gravadas com as memórias esperadas), rodados a cada mudança de prompt ou de modelo, com resultados comparáveis entre versões.
- **Conjuntos dourados (entrega da Fase 0):** (a) 100 prompts reais rotulados com projeto, thread viva e workspace, extraídos do histórico de threads do usuário (o `statev2.sqlite` de dev, copiado, serve de fonte); (b) 20 threads gravadas com as memórias esperadas. Sem esses conjuntos os gates das Fases 1, 3 e 4 não podem ser medidos.
- **Latência da `ModelClient` (entrega da Fase 0):** medir partida fria e quente do classificador por CLI e por Ollama; o resultado decide o padrão entre `lexical-only` e LLM.
- **Uso real:** duas semanas de uso diário nos projetos reais antes de dar a Fase 5 por concluída.

## 11. Riscos, questões em aberto e decisões

**Riscos**

| Risco                                                                                             | Impacto                                  | Mitigação                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| O upstream muda a arquitetura (eventos, MCP, injeção)                                             | Retrabalho no fork                       | Poucos pontos de contato, testes de contrato, rebase semanal                                               |
| Alguns adapters só injetam no início da sessão (Claude, ACP, Cursor, Pi)                          | Memória fica estática nesses provedores  | Tabela de canais em 5.4; `memory_recall` cobre o resto                                                     |
| Chamar o CLI como subprocesso para classificar tem partida fria de 1 a 3 s                        | O p95 < 3 s (A2) pode não fechar         | Medir na Fase 0; se não fechar, `lexical-only` como padrão e LLM opcional                                  |
| Gatilhos por tempo (10 min ocioso, 8 turnos) com timers só em memória perdem trabalho no reinício | Memórias não extraídas                   | Persistir no `EffectOutbox` com `due_at`                                                                   |
| Roteamento errado                                                                                 | Agente trabalha no projeto errado        | Três faixas de confiança, chip de troca, aprendizado com correções                                         |
| Memória de baixa qualidade (ruído, fatos errados)                                                 | Contexto poluído, agente induzido a erro | Limiar de confiança, deduplicação, painel de revisão, desfazer por thread, avaliação com conjunto de teste |
| Custo e latência das chamadas ao modelo                                                           | Lentidão e gasto                         | Caminho léxico primeiro, modelo pequeno, extração em segundo plano, opção local                            |
| Dados sensíveis na memória                                                                        | Vazamento para outro agente ou projeto   | Redação, escopo por projeto, `pending_review`, exclusão real                                               |
| Contexto injetado ocupa espaço útil                                                               | Respostas piores em tarefas pequenas     | Orçamento em bytes (seção 5.4), só o relevante, medição de uso por memória                                 |

**Questões em aberto (decidir antes da Fase 1)**

1. **Modelo padrão** do classificador e do extrator: Haiku via CLI já autenticado, ou local via Ollama? Qual hardware está disponível?
2. **Banco central ou por projeto?** A spec propõe um banco central. A alternativa é um `.t3/memory.db` em cada repositório (portável e versionável, mas arriscado se for commitado por engano).
3. **Embeddings:** entram na Fase 5 como opcional, ou ficam fora?
4. **Threads iniciadas fora do T3:** o T3 já escaneia transcritos locais de Claude e Codex (\`AgentSessionScanner\`); reaproveitar isso para gerar memória retroativa, ou só valer para threads novas?
5. **Memória global** (preferências do usuário entre projetos): ligada por padrão ou opt-in? A spec assume opt-in.
6. **Sistema operacional** alvo da primeira versão (Linux, macOS ou Windows) e se o app desktop também deve ser suportado desde a Fase 1.
7. **Nome e distribuição** do fork (nome próprio, `npx`, app desktop).

### 11.0 Medições da Fase 0

| Medição                                                                        | Resultado                                                                                 | Consequência                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latência de `claude -p --model haiku` por chamada (3 execuções, mesma máquina) | 7,5 a 7,8 s, sem diferença entre a primeira e as seguintes                                | O classificador por CLI não cabe no p95 < 3 s (A2) nem no `timeout_ms = 5000`. O router síncrono fica em `lexical-only`; o LLM só serve a tarefas em segundo plano, como a extração |
| Ollama                                                                         | Não instalado nesta máquina                                                               | Alternativa local só depois de instalar e medir                                                                                                                                     |
| Conjunto dourado de roteamento                                                 | 95 prompts: 63 reais (76% de um projeto) e 32 sintéticos em 8 projetos, em `~/t3-golden/` | Abaixo dos 100 previstos; ver decisão 8                                                                                                                                             |

**Primeira medição do router léxico (Fase 1)**

Com `packages/router` e perfis escritos à mão (`~/t3-golden/profiles.json`), sobre 83 prompts com projeto conhecido (51 reais e 32 sintéticos) e 10 prompts sem projeto:

| Métrica                                      | Resultado                       |
| -------------------------------------------- | ------------------------------- |
| Responde (tem candidato com sinal)           | 40 de 83 (48%); abstém-se em 43 |
| Acerto top-1 quando responde                 | 87,5% (35 de 40); 5 erros       |
| Prompts sem projeto que caíram em "pergunta" | 10 de 10                        |
| Faixa automática (≥ 0,85)                    | 0; confirmação 18; pergunta 65  |

Leitura: o A1 (≥ 90%) **não foi atendido** no conjunto atual; por isso vale a decisão 16 (cartão de confirmação sempre, `auto_start = false`). O conjunto tem viés: a maioria dos prompts reais são continuações curtas ("pois é...", "create one plan") que, no uso real, vão para a thread aberta e não passam pelo router, e os perfis foram escritos por quem já conhecia os prompts. A1 precisa ser remedido sobre prompts que iniciam uma thread, com o log de decisões do router.

**Pontos de contato verificados (Fase 0)**

| Ponto               | Achado                                                                                                                                                                                                                                                                                                   | Impacto                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Criação de thread   | O router chama `ThreadLaunchService.launch` (`orchestration-v2/ThreadLaunchService.ts`), não a ferramenta MCP. Entrada: `commandId` (recibo idempotente), `projectId`, `title`, `modelSelection`, `runtimeMode`, `interactionMode`, `workspaceStrategy`, `initialMessage`, `createdBy`, `creationSource` | O router precisa também decidir provedor/modelo e modos; usa `default_provider` do projeto. `creationSource` identifica threads criadas pelo router                             |
| Reactors            | Padrão: serviço com `start()` (escopo) e `handle(event)`, que reage a eventos do `OrchestratorV2` e envia comandos por `engine.dispatch` (`DelegatedTaskQuestionReactor`). `EffectOutbox`/`EffectWorker` são usados por `EventSink`, `Orchestrator`, `ProviderRuntimeRecoveryService` e `ThreadDeletion` | A extração segue o padrão de reactor; o trabalho durável (reinício no meio) usa o outbox como esses serviços. O `PullRequestSyncReactor` citado na seção 2.1 não foi confirmado |
| Comandos de cliente | `createEnvironmentRpcCommand` em `packages/client-runtime/src/state/*.ts`; escopos em `CLIENT_GUARDED_RPC_SCOPES` (`packages/contracts/src/clientRpcPermissions.ts`)                                                                                                                                     | Comandos `router.*` e `memory.*` da seção 6.2 precisam de escopo e de teste de permissão                                                                                        |
| UI                  | A tela inicial é `IndexDraftLanding` (`apps/web/src/routes/_chat.index.tsx`), com lista de projetos e `useNewThreadHandler`; a rota `/new` abre threads por link; configurações em `_chat.settings.*`; atalhos em `components/chat/useChatShortcuts.ts`                                                  | O compositor global estende a tela inicial; entradas a cobrir: tela inicial, atalho, command palette e configurações (Router e Memória)                                         |

### 11.1 Decisões tomadas

Registradas na revisão com o autor; substituem os padrões propostos anteriores.

| #   | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fork próprio com router e memória inteiros; a parte manual de memória só é oferecida ao upstream depois de estável, e nenhuma fase depende da resposta deles                                                                                                                                                                                                                                                                                                                                         |
| 2   | Banco separado `<T3 home>/userdata/memory.db` com migrações próprias; excluir um projeto passa a ser operação em dois bancos                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | Router em `lexical-only` e extração `off` até medir a latência na Fase 0                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Memória opt-in por projeto (`opt_in_only = true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | Router confirma sempre no começo (`auto_start = false`); o modo automático só liga depois do G1                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | Ordem das fases: router (Fase 1), depois memória manual (Fase 2)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | Linux e desktop na v1; mobile fica fora da UI e herda o servidor; macOS e Windows sem código próprio                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | Conjunto dourado: o `statev2.sqlite` do T3 tem só 3 threads e 1 projeto, então a fonte é o `~/.claude/history.jsonl` (63 prompts úteis, 76% de um único projeto). O conjunto fica fora do repositório (`~/t3-golden/`, permissão 600), completado por prompts sintéticos marcados como tal; o autor revisa uma amostra de cerca de 20 casos, priorizando prompts curtos ou genéricos. O A1 só vale como medida real depois que o log de decisões do router acumular prompts reais de vários projetos |
| 9   | Branches protegidas: `main`, `master`, `develop` e o que for listado por projeto; sem consultar o GitHub                                                                                                                                                                                                                                                                                                                                                                                             |
| 10  | Extração só no fim de turno com mudança de arquivo e no fechamento da thread                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 11  | Nas duas primeiras semanas, memória automática entra como `pending_review`; depois, as de confiança alta entram como `active`                                                                                                                                                                                                                                                                                                                                                                        |
| 12  | Sem servidor MCP standalone na v1; CLIs externos usam o `/mcp` do T3                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 13  | Espelho em `AGENTS.md` só na Fase 5, desligado por padrão                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 14  | Prompt com vários projetos: para e pergunta; não divide em threads na v1                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 15  | Nome do fork definido no fim da Fase 0; até lá, o nome do upstream em todo o código                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 16  | G1 falho: o router segue no ar, sempre com cartão de confirmação; só abandona se o top-3 também for fraco                                                                                                                                                                                                                                                                                                                                                                                            |
| 17  | G2 falho: `workspace_mode` fica em `ask`, com a recomendação marcada no chip                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 18  | Correções só são gravadas; limiares e pesos não se ajustam sozinhos na v1                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 19  | A regra de 14 dias só tira a thread das candidatas do router, sem alterar o T3; com `maxTokens` nulo, o limiar de 60% não se aplica                                                                                                                                                                                                                                                                                                                                                                  |
| 20  | A spec fica em `docs/` do fork; o AGENTS.md do upstream não se aplica ao fork                                                                                                                                                                                                                                                                                                                                                                                                                        |

Mantidos dos padrões anteriores: embeddings fora da v1; memória retroativa opt-in por projeto; memória global opt-in; distribuição a partir do repositório, sem registro na v1.

## 12. Estado do fork (fim do ciclo de implementação)

Branch `fork/orchestrator-memory`, 41 commits locais sobre `origin/main` (`5b354026`), 105 arquivos, cerca de 8,5 mil linhas. Nada foi enviado ao remoto. Tudo vem **desligado**: `routerEnabled = false`, `memoryEnabledProjectIds = []`, `memoryExtractor = "off"` (cobertos por teste em `packages/contracts/src/settings.test.ts`).

### 12.1 Entregue

| Fase | O que existe                                                                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Medições (11.0), fontes do conjunto dourado, pontos de contato verificados                                                                                                                                                                                              |
| 1    | `packages/router` (menção, BM25, política de confiança); `memory.db` com perfis e `routing_feedback`; `router.classify`/`recordChoice`; perfil derivado da pasta e editável (Settings > Beta > Project names); chip de projeto no rascunho; `auto_start` fica desligado |
| 2    | `packages/memory`; ferramentas MCP `t3_memory_*`; injeção no primeiro turno de cada thread nativa (Codex como contexto não confiável, demais com prefixo); painel e switch por projeto; limpeza de projetos apagados no início do servidor                              |
| 3    | Planejador de workspace; estimativa de impacto; leitura de threads vivas; escolha enviar/enfileirar/nova/nova com handoff; linhas no cabeçalho do rascunho; `workspace_feedback`                                                                                        |
| 4    | Extração por modelo (`ModelClient`, desligado), redação de segredos, validação da saída, dedupe/supersede, revisão nas 2 primeiras semanas, desfazer por thread, semente de `CLAUDE.md`/`AGENTS.md`                                                                     |
| 5    | Espelho opcional em `AGENTS.md` (manual); edição de perfil do router                                                                                                                                                                                                    |

### 12.2 Não medido ou não verificado

| Item                     | Situação                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| A1 router ≥ 90%          | 87,5% quando responde, 48% de cobertura, sobre 51 prompts reais (76% de um projeto) e 32 sintéticos; viés dos perfis escritos à mão |
| A2 latência              | Léxico não medido em milissegundos; LLM por CLI = 7,6 s, fora da meta, por isso fora do caminho síncrono                            |
| A3 entre provedores      | Coberto por teste de serviço, **não** por execução real com Claude e Codex                                                          |
| A4 qualidade da extração | Não medido (precisa de modelo real e threads gravadas)                                                                              |
| A8 isolamento            | `check:changed` por mudança; suíte completa do upstream **não rodada**                                                              |
| B1, B2, G1, G2           | Dependem de uso real; `workspace_feedback` e `routing_feedback` coletam; não há relatório de concordância                           |
| UI                       | Nenhuma captura de tela; nenhum navegador aberto; nenhuma execução do servidor com as camadas novas                                 |
| Duas semanas de uso real | Não feitas                                                                                                                          |

### 12.2.1 Limites conhecidos

- A fila de extração é em memória (reinício perde pendentes) e não há gatilho de fechamento de thread nem `thread_summaries`.
- A limpeza de notas de projetos apagados acontece só ao iniciar o servidor.
- O chip só informa e abre a thread sugerida; não move o texto nem enfileira.
- O resumo "memórias salvas desta thread" existe apenas no painel.
- Claude, ACP, Cursor e Pi recebem as notas como prefixo do primeiro prompt, não no prompt de sistema.
- Importação a partir de transcritos do `AgentSessionScanner` não foi feita.
- O Ollama nunca foi exercitado (não instalado).

### 12.3 Desvios da spec original

- `router.confirm`/`router.override` viraram `router.recordChoice`; `router.planWorkspace`, `getProfile`, `updateProfile`, `recordWorkspaceChoice` e `memory.list/create/update/delete/undoThread/seed/mirror` foram acrescentados.
- Servidor MCP standalone ficou de fora (decisão 12).
- `inject_budget_bytes` virou 3.500 bytes por seção; o extrator é um único campo `memoryExtractor`.
- O classificador por LLM não é usado no router (latência).

### 12.4 Pontos de contato com o upstream (para o rebase semanal)

Arquivos do upstream tocados (o resto é código novo em `apps/server/src/fork/`, `apps/server/src/mcp/toolkits/memory/`, `packages/router`, `packages/memory` e arquivos novos em `apps/web` e `packages/contracts`):

| Arquivo                                                                                                  | Mudança                                                           |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`, `clientRpcPermissions.ts`, `settings.ts`, `index.ts`                    | Métodos RPC `router.*` e `memory.*`; três campos de configuração  |
| `apps/server/src/ws.ts`, `ws.test.ts`, `auth/RpcAuthorization.ts`, `observability/RpcInstrumentation.ts` | Handlers finos, escopos, categoria de instrumentação, mocks       |
| `apps/server/src/server.ts`                                                                              | Reactor de extração e três serviços no `mergeAll` interno         |
| `apps/server/src/orchestration-v2/runtimeLayer.ts`                                                       | `RouterService`, `MemoryService`, `MemoryPurge`                   |
| `apps/server/src/orchestration-v2/RunExecutionService.ts`                                                | Injeção de notas no primeiro turno (`Effect.serviceOption`)       |
| `apps/server/src/mcp/McpHttpServer.ts`                                                                   | Registro do toolkit de memória                                    |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` (+ teste)                                 | Ferramentas de leitura na lista permitida do modo somente leitura |
| `packages/shared/src/t3McpToolPresentation.ts`, `packages/client-runtime/src/t3ToolSummary.ts`           | Rótulos das ferramentas `t3_memory_*`                             |
| `apps/web/src/components/chat/DraftHeroHeadline.tsx`                                                     | Chips de projeto, workspace e thread                              |
| `apps/web/src/components/settings/BetaSettingsPanel.tsx`, `settingsSearch.ts`                            | Switch, seletor do extrator, seções de memória e nomes            |
| `apps/server/package.json`, `pnpm-lock.yaml`                                                             | Dependências de workspace                                         |

Cada novo método RPC exige tocar `rpc.ts`, `clientRpcPermissions.ts`, `RpcAuthorization.ts`, `RpcInstrumentation.ts`, `ws.ts` e o mock em `ws.test.ts`. Um toolkit MCP novo com ferramentas de leitura precisa entrar na lista de `ClaudeAdapterV2.test.ts`.

### 12.5 Como ligar para testar

1. Settings > Beta: ligar "Project suggestions" (chips) e, por projeto, o switch de "Project memory".
2. Preencher "Project names" dos projetos que o router confunde.
3. Opcional: "Write notes automatically" = Claude Haiku (o resumo do run vai à Anthropic pelo CLI).
4. Rodar `vp run check:changed` e depois a suíte completa antes de qualquer envio.
