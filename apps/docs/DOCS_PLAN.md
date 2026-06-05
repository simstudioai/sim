# Sim Docs — Content Plan (concept treatment per feature)

> Status: planning artifact. The IA (sidebar) is settled; this is the **content backlog** —
> the concept/explainer pages each feature needs, what they cover, suggested visuals, and layout.
> Nothing here moves files or re-explodes `execution/*` — that folder stays cohesive under Platform.
> New concept pages are **builder-facing** and cross-link *into* Platform/Execution for the mechanics.

## Principles
- **Audience:** teams building AI agents (builders, operators, technical-non-engineers) PRIMARY; developers secondary.
- **Per section:** concept/explainer → how-to → reference. Each feature gets a real conceptual treatment.
- **Source material:** the Academy modules already drafted (`content/docs/en/academy/*`) are the explainer scripts — promote them into written docs. Docs and Academy share one ontology.
- **Status tags:** `[EXISTS]` keep · `[DRAFT]` exists, rewrite/reframe · `[TODO]` write new.
- **Visuals:** every concept page should lead with a diagram or short video; every how-to with screenshots.

---

## Priority backlog (ranked)

**P0 — biggest gaps, highest impact**
1. **Workflows overview + anatomy + data flow** — the #1 gap; Workflows section currently has no "what is a workflow / how it runs / how data flows."
2. **Tables → Workflow Columns / Active Tables** — the missing differentiator ("the table is the agent; the pipeline comes to the data").
3. **Files → Using files in workflows + Generating files** — builder how-tos; today only a thin overview + a dev-reference under Platform.
4. **Deployment concept page** — a builder explainer (what/why/versioning/channels) that links into Platform/Execution mechanics.
5. **Logs & Debugging concept page** — the "trace data backward" method; links into Platform/Execution/Logging.
6. **Capabilities overview + "Choosing a capability"** — the decision matrix (block vs agent-tool vs custom tool vs MCP vs workflow-as-tool vs skill) + an Agents concept.

**P1**
7. **Knowledge Bases** — add *Using KBs in workflows* + *Debugging retrieval*; reorder `chunking-strategies` LAST (reference).
8. **Mothership** — promote the *build → inspect → run → refine* loop and *prototype → stabilize → promote* lifecycle from Academy into concept pages.
9. **Workspaces & Access** — a "workspace as system boundary / customer app" concept overview.
10. **Reframe the Platform/Execution intros** — retitle `costs` → "Plans & Pricing"; add concept→mechanics cross-links on `execution/{index,basics,files,api,logging}`.

**P2** — cross-linking pass, jargon trim (DAG/resolver in connections, blocks), audience callouts on self-hosting/enterprise.

---

## Get Started
**Purpose:** Zero → "I have a working system." Orient to the object model + Mothership, then a quick win.

| Page | Status | Type | Covers / notes | Visuals |
|---|---|---|---|---|
| `introduction/index` | [EXISTS] rewritten | concept | object model + how-you-build (Mothership/visual/API). Could become a card-grid hub. | hero of workspace; object-relationship diagram |
| `getting-started/index` | [EXISTS] | tutorial | strong 10-min quickstart — keep | (has screenshots/videos) |
| `mothership/index` ("Building with Mothership") | [EXISTS] | concept/how-to | Mothership as the front door | 2-pane chat+canvas; scaffold→refine |
| *Three ways to build* | [TODO] optional | concept | when to use Mothership vs visual builder vs API (speed/control/observability) | 3-column decision cards |

**Missing context:** an explicit "what just happened when Mothership built my workflow?" bridge; where logs fit after the first run.

---

## Workflows  ← biggest investment
**Purpose:** Install the workflow mental model — what it is, how data flows, how it runs — *before* blocks/connections reference. Today this section is thin (connections, variables, copilot, blocks) with no overview.

| Page | Status | Type | Covers | Visuals |
|---|---|---|---|---|
| `workflows/index` (Overview) | [TODO] **P0** | concept/hub | a workflow is a visual program made of blocks; trigger → blocks → output; it's the executable center that consumes tables/KBs/files/tools and is exposed by deployments and inspected by logs. Card grid to children. | hero `Start → Agent → Response`; "workflow in system context" diagram |
| `workflows/anatomy` | [TODO] **P0** | concept | triggers/inputs · blocks/steps · outputs/response · connections/data flow · context (variables, block outputs) | labeled simple-workflow diagram |
| `workflows/how-it-runs` | [TODO] P0 | concept | dependency-based execution, branching (condition/router), loops, parallel, error paths, response as exit. "why did it do that?" via run path. *Cross-link `execution/basics`.* | sequential/branch/parallel/loop diagrams; run-log path |
| `workflows/data-flow` | [TODO] P0 | concept/how-to | outputs→inputs, `<block.field>` refs, shape (string vs object, nested, arrays), `JSON.stringify` before prompts, the `[object Object]` bug, debugging via logs. *(The #1 real-bug source.)* | output-inspect screenshot; before/after shape transforms |
| `connections/*` | [EXISTS] | reference | keep; cross-link from anatomy/data-flow | (has) |
| `variables/*` | [EXISTS] | reference | keep | (has) |
| `copilot` | [EXISTS] | how-to | the workflow build assistant — keep | (has) |
| `blocks/index` (+ generated block pages) | [EXISTS] reference | reference | keep; add a "common patterns" section (sequential, branch, quality-control, error-handling) | pattern diagrams |

**Missing context:** the unified mental model; "most workflow bugs are data-flow bugs"; how workflows connect to every other resource (explicit cross-links). Mine `academy/workflows/*` for all four concept pages.

**Layout (workflows/index):** hero + one-paragraph "where AI systems run" + 3-card concept grid (Anatomy / Execution / Data) + system-context diagram + next-steps cards + short FAQ.

---

## Tables
**Purpose:** Structured state — and the active-table superpower (run a workflow per row, write results back). Today only a thin UI overview; the key concept is absent.

| Page | Status | Type | Covers | Visuals |
|---|---|---|---|---|
| `tables/index` (Overview) | [EXISTS] | concept/reference | what tables are + UI mechanics — keep, add a callout to Workflow Columns | table as input+output to a workflow |
| `tables/workflow-columns` (Workflow Columns & Active Tables) | [TODO] **P0** | concept/how-to | what a workflow column is; **input vs output columns** (the confusing part — make explicit with a function-signature framing); set-up steps; lead-enrichment example; **cascades** (column feeds the next); rerun/failed-row behavior; when NOT to use | "pipeline comes to the data" diagram; before/after enrichment table; step screenshots; cascade arrows |
| `tables/using-in-workflows` | [TODO] P1 | how-to | the Table block (query/insert/update/delete); read with filters; write-back; lookup/iteration patterns | Table→Agent→Table write-back |
| `tables/table-backed-systems` | [TODO] P2 | tutorial | when to build table-backed systems; GTM/support-triage examples | end-to-end graph |

**Missing context (gate the workflow-columns page):** input vs output column definitions, which rows run, failure/rerun behavior, cascade access, manual rerun. These are open product questions — confirm before writing authoritatively. Mine `academy/tables/*`.

---

## Files
**Purpose:** The artifact layer. Today: one real concept overview; the mechanics live under Platform (`execution/files`).

| Page | Status | Type | Covers | Visuals |
|---|---|---|---|---|
| `files/index` (Overview) | [EXISTS] | concept | what files are; file vs table vs KB — keep | artifact-flow diagram |
| `files/using-in-workflows` | [TODO] P0 | how-to | upload/reference a file; pass to an agent/vision block; retrieve from Gmail/Slack; PDF→summary example | file-input in Start; logs |
| `files/generating` | [TODO] P1 | how-to | blocks that produce files (TTS, image-gen, Function→markdown/PDF, agent output); where saved; naming | output→Files panel |
| `files/vs-tables-vs-kbs` | [TODO] P2 | concept | decision tree; contract example (File→extract→Table→KB) | venn/flow |
| `execution/files` ("Passing Files") | [EXISTS, under Platform] | reference | the dev mechanics (UserFile schema, base64, API payloads) — stays in Platform; cross-link from `files/using-in-workflows` | (has) |

**Missing context:** folders/retention/size limits/overwrite behavior. Files product direction is unstable — keep conservative. Mine `academy/files/*`.

---

## Knowledge Bases
**Purpose:** Searchable memory. Well-built; ordering is off and two how-tos are missing.

| Page | Status | Type | Covers | Visuals |
|---|---|---|---|---|
| `knowledgebase/index` | [EXISTS] | concept | keep; add "choose your path" CTAs | upload→chunk→search |
| `knowledgebase/using-in-workflows` | [TODO] P1 | how-to | the Knowledge block (semantic/tag/combined), top-K, thresholds, citations | block config; retrieved chunks |
| `knowledgebase/connectors` | [EXISTS] | how-to | keep | (has) |
| `knowledgebase/tags` | [EXISTS] | how-to | keep | (has) |
| `knowledgebase/debugging-retrieval` | [TODO] P1 | how-to | "why isn't my KB answering?" checklist; chunk/query problems; quick fixes | retrieved vs expected |
| `knowledgebase/chunking-strategies` | [EXISTS] **reorder LAST** | reference | move to end of section (it's deep reference, currently 2nd) | (has) |

**Action:** update `knowledgebase/meta.json` order → `index, using-in-workflows, connectors, tags, debugging-retrieval, chunking-strategies`. Mine `academy/knowledge-bases/*`.

---

## Capabilities
**Purpose:** How agents act — and which primitive to choose. Today: MCP + skills only; no Agents concept, no decision guide, "tool" is overloaded.

| Page | Status | Type | Covers | Visuals |
|---|---|---|---|---|
| `capabilities/index` (Overview) | [TODO] P0 | concept | capabilities = how agents act; the primitives (block, agent tool, integration, custom tool, MCP, workflow-as-tool, skill); structured outputs as a cross-cutting pattern | decision matrix |
| `capabilities/choosing` (Choosing a capability) | [TODO] **P0** | concept/decision | the matrix: always-run→block; agent decides→tool; reusable code→custom tool; external→MCP; whole workflow→workflow-as-tool; reusable instructions→skill | big decision table/tree |
| Agents concept | [TODO] P1 | concept | the Agent block as the reasoning core; system/user prompt; tools (auto vs forced; prefilled vs model-filled params); structured outputs; inspectable output (content/toolCalls/tokens/cost) | agent in a workflow; output sample |
| `mcp/index` (Using MCP Tools) | [EXISTS] | how-to/concept | keep | (has) |
| `mcp/deploy-workflows` | [EXISTS] | how-to | "expose a workflow as MCP" — keep near MCP | (has) |
| `skills/index` | [EXISTS] | concept/how-to | reframe as "reusable instructions/playbooks"; skill-vs-prompt | load sequence |

**Missing context:** precise tool vs integration vs custom-tool vs MCP distinction; auto vs forced; tool-failure/retry behavior; what "custom tool" is in-product. Mine `academy/agents-tools-mcp-skills/*`.

---

## Mothership
**Purpose:** The NL control plane + the build-verify discipline. Today: per-resource how-tos; the marquee concepts live only in Academy.

| Page | Status | Type | Covers | Visuals |
|---|---|---|---|---|
| Build-verify loop | [TODO] P1 | concept/how-to | specify → scaffold → inspect → run → debug → refine; macro→micro; "architect, not QA" | circular loop diagram; rough→refined |
| Prototype → Stabilize → Promote | [TODO] P1 | concept | the lifecycle; when each phase is "done"; hand-off to Deployment/Logs | 3-phase diagram |
| Non-determinism & convergence | [TODO] P2 | concept | same intent ≠ same graph; evaluate by behavior, not topology | two valid runs |
| `mothership/{workflows,research,files,tables,tasks,knowledge}` | [EXISTS] | how-to | keep; add a "build-verify loop" link to each; cross-link to the matching resource section | (has) |
| `mailer` | [EXISTS] | how-to | keep in Mothership (email→**task** channel) | (has) |

**Note:** the basic Mothership overview lives in Get Started ("Building with Mothership"); these are the *advanced* topics. Mine `academy/mothership/*`.

---

## Workspaces & Access
**Purpose:** The system boundary + access + secrets. Pages are solid; the unifying concept is missing.

| Page | Status | Type | Covers | Visuals |
|---|---|---|---|---|
| Workspace fundamentals | [TODO] P1 | concept | what a workspace contains; system boundary; personal vs team; **workspace-as-customer-app** (partner/enterprise) | workspace-contents diagram |
| `integrations/*` (Connecting accounts) | [EXISTS] | how-to/reference | keep; note how an integration becomes an agent tool | account→tool mapping |
| `permissions/roles-and-permissions` | [EXISTS] | reference/how-to | keep; add "common team setups" | permission matrix |
| `credentials/index` (Secrets) | [EXISTS] | how-to/reference | keep; workspace-vs-personal diagram | resolution order |
| Workspace organization | [TODO] P2 | how-to | folders, naming, archiving; split workspaces vs folders | before/after sidebar |

Mine `academy/workspaces-credentials-permissions/*`.

---

## Platform  (= the technical / internals / operations layer)
**Purpose:** How Sim runs under the hood + how you operate it. `execution/*` stays cohesive here. Frame Platform explicitly as "mechanics & operations," and point *out* to the builder concepts.

| Group | Status | Note |
|---|---|---|
| `execution/index` (Overview) | [DRAFT] | add intro callout: "for deployment strategy see Deployment; for debugging see Logs & Debugging." It's the engine overview. |
| `execution/basics` | [EXISTS] | builder-readable execution model; cross-link from `workflows/how-it-runs` |
| `execution/files`, `api`, `api-deployment`, `chat`, `form`, `logging` | [EXISTS] | mechanics/reference; add concept→mechanics cross-links |
| `execution/costs` | [DRAFT] | retitle "Plans & Pricing" / "Understanding costs"; surface a pointer from Get Started |
| `self-hosting/*` | [EXISTS] | add audience callout ("for teams self-hosting; cloud users skip") |
| `enterprise/*` | [EXISTS] | add audience callout ("for org admins / security & compliance") |

---

## Deployment & Logs — the reconciliation
These were removed as *sections* because they were nothing but exploded `execution/*`. But each **feature deserves a concept page** (and both are Academy modules). Recommendation (confirm before executing):

- Add a small **Deployment** section = ONE new concept page (`deployment/index`, [TODO] P0) covering the unified deploy model, snapshots/versioning, channels (API/chat/form/MCP/email), staging→prod — that **links into** `execution/api-deployment`, `chat`, `form` and `mcp/deploy-workflows` for the how-to mechanics. The mechanics stay in Platform.
- Add a small **Logs & Debugging** section = ONE new concept page (`logs-debugging/index`, [TODO] P0): logs as trace data, the "trace data backward" method, common failure patterns — linking into `execution/logging` (UI reference) and `execution/api` (logs API).

This is *not* re-exploding execution; it's adding the two missing builder concepts as thin sections that point at the mechanics. Mirrors the Academy's Deployment and Logs modules.

---

## Reference
Quick Reference, Keyboard Shortcuts, and the generated catalogs (Blocks, Integrations [tools], Triggers). No content work — just framing notes at the top of each catalog ("for managing integrations in your workspace, see Connecting accounts").

---

## Cross-cutting
- **Visual system:** standardize concept-page diagrams (object model, workflow anatomy, data flow, deploy cycle, debug loop, capability matrix, table-as-pipeline). These are reusable across docs + Academy.
- **Page-type badges:** the `pageType` frontmatter + badge already exist — tag new concept/how-to/reference pages as written.
- **Docs ↔ Academy:** every concept page should link to its Academy module and vice-versa (shared ontology).

## Open product questions (block authoritative docs)
Workflow-columns: input/output column semantics, row selection, failure/rerun. · Files: access model, folders, retention, size. · Skills: skill-vs-prompt, invocation, scope. · Tool uniqueness/retry behavior. · Deployment: official staging/prod recommendation, shared live version across surfaces. · Credentials: redaction in logs, personal-vs-workspace usage rules.
