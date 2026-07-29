# Migrating a resource onto the resource layer

Follow-up work after the file and interface resources were moved onto the three axes.

This is the playbook for making a resource — a table, a knowledge base, a log, a scheduled task —
render the same way everywhere: on its own page, in a chat/mothership tab, inside an interface
module, and on a public share. Read `.claude/rules/sim-resource-views.md` first; that is the rule.
This is the migration plan.

## Where things stand

| Resource | Canonical view | Consumers today | Notes |
| --- | --- | --- | --- |
| **file** | `components/resources/file-view` | Files page, mothership panel, interface module, `/f/[token]` | Done. The reference implementation. |
| **interface** | `components/resources/interface-view` | editor page, mothership panel, `/i/[token]` | Done. |
| **table** | — | tables page only, **plus a hand-rolled copy** in the interface table module | Next, and the highest value. |
| **knowledge** | — | knowledge page, mothership panel | No public consumer yet. |
| **log** | — | logs page, mothership panel, tables page | `LogDetailsContent` is already shared; it just leaks context. |
| **schedule** | — | scheduled-tasks page, mothership panel | Smallest surface. |
| **workflow** | *deliberately excluded* | — | Not a document. See "Why workflow is not a resource". |
| **folder** | *not a resource* | — | Organisational structure inside files/knowledge, not a thing you render. |

A kind with no canonical view is simply absent from `CANONICAL_UNITS` in
`scripts/check-resource-views.ts`. That is the correct state for an unmigrated kind — it needs no
flag, shim, or placeholder entry.

## The contract you are migrating onto

Three axes, defined in `apps/sim/resources/**` (pure TypeScript — no React, no `'use client'`,
because a Server Component builds a share source during SSR):

```ts
source  // WorkspaceSource<K> | ShareSource<K>, discriminated on `via`
grants  // { write: boolean; run: boolean }
host    // 'page' | 'panel' | 'public'
```

A consumer **constructs** those three values and **mounts** the view. It does not wrap it, reach past
its barrel, or invent a fourth spelling for "read-only" or "embedded".

## The migration, step by step

### 1. Find the seam, then draw the line

Open the existing surface and separate **presentation** from **mutation**. The presentational half
becomes the canonical view; the editing shell stays in the route page and wraps it.

The test: could this subtree render correctly for someone holding only a share token and no workspace
identity? If yes it is presentational. If it calls `useParams()`, a permission context, or a mutation
hook, it is shell.

### 2. Add the seam rather than forking the UI

This is the rule the whole layer exists to enforce. If the view cannot express what a consumer needs,
change `source` / `grants` / `host` — one place, every consumer — or add an optional object prop
(`streaming`, `editing`) and register it in `SANCTIONED_VIEW_PROPS`.

Never reimplement. The interfaces table module is the cautionary tale: it hand-rolls a read-only
table because `TableGrid` had no seam, and in doing so loses booleans, JSON, dates, links, resource
chips, pinned columns and windowing — every one of which the real grid already handles.

### 3. Move it out of the route tree

`apps/sim/components/resources/<kind>-view/`, with `<kind>-view.tsx` + `index.ts`, children under
its own `components/`, hooks in `hooks/`, pure helpers in `utils/`. Delete the original in the same
change and update every importer. Nesting a shared unit under `app/workspace/[workspaceId]/` is
exactly why `workspaceId: string` once read as natural on a component anonymous visitors mounted
with a share token.

Keep `lazy()`/`dynamic()` split points importing **deep paths**, never the barrel — `apps/sim` has no
`sideEffects: false`, so routing a split point through a barrel silently re-attaches the chunk.

### 4. Give the kind a seed, or type it `never`

In `apps/sim/resources/kinds.ts`, `ResourceSeedMap` says what a share token carries for that kind.
`never` means the kind has no public surface and **cannot** construct a share source — a compile-time
fact, not a convention. Only widen it when you are actually building the public surface.

### 5. Add token-scoped routes if the kind goes public

Addressed by `(token, grantId)` and nothing else. No resource id on the wire — the server derives the
resource from the stored share on every request, so there is nothing for a caller to forge. Mirror
`lib/public-shares/interface-access.ts`.

### 6. Register and ratchet

Add the unit to `CANONICAL_UNITS`. Migrate every consumer in the same PR. Lower the `R1b`
(`shadowNamedComponents`) baseline as each `Embedded*` component for that kind disappears.

---

## Table — the next one, and the one that pays

Everything above is abstract until a resource with no existing seam goes through it. Files and
interfaces already shared components, so consolidating them cost more than it recovered. Tables is
where the ledger turns.

**What it buys**

- The hand-rolled table in the interface module collapses (~156 lines → ~30) and gains every cell
  renderer it currently lacks.
- Tables become publicly shareable for the first time.
- The mothership stops mounting the entire tables route page to show a table.

**Why it is hard**

`tables/[tableId]/components/table-grid/table-grid.tsx` is ~3,963 lines with no component tests and
live collaborative editing. It reads `useParams()`, `useUserPermissionsContext()`, and roughly
fourteen authenticated mutation hooks.

**The good news:** the cell layer is *already* factored correctly. `cells/cell-render.tsx` splits into
a pure `resolveCellRender()` returning a typed `CellRenderKind` union and a dumb `<CellRender/>`;
`cells/cell-content.tsx` is only glue plus the inline editor. That split is the model for the rest.

### Suggested sequencing — three PRs, not one

**PR 1 — move, no behaviour change.** Relocate the presentational subtree to
`components/resources/table-view/`: `TableColGroup`, headers, `DataRow`, `cells/` (minus
`InlineEditor` and `ExpandedCellPopover`), and the virtualizer wiring. Keep the editing shell in
`tables/[tableId]/`. Nothing renders differently. Land this alone so the diff is reviewable.

**PR 2 — give it the axes.** `TableView` takes `{ source, grants, host }`. Rows and schema resolve
from the source: workspace scope keeps the existing `tableKeys` factory deliberately — an open table
and an interface's table module *should* hit one cache entry, and forking that doubles every fetch —
while share scope reads a `(token, grantId)` route. Replace the interfaces mini-table with a mount
and delete it.

**PR 3 — public surface.** Token-scoped rows route, `ResourceSeedMap['table']` carrying the column
schema, `/t/[token]` or a table module inside a shared interface.

### Watch out for

- **`resolveCellRender` takes `currentWorkspaceId`** and emits a `sim-resource` chip for in-workspace
  URLs. `SimResourceCell` then fetches workspace lists to resolve names. In share scope pass
  `undefined`: the resolver never emits that kind, the URL falls through to a plain favicon link, and
  no workspace-authenticated query is mounted. Assert this in a test — it is the security property.
- **Row execution metadata** (`exec`) carries run ids, statuses and costs. The public rows contract
  already reads with `withExecutions: false`; keep it that way and let workflow-output columns resolve
  on the value path.
- **Do not make the editing grid scope-aware.** Keep the split at read-only-presentational vs
  editing-shell, or mutation hooks end up shipped to anonymous surfaces.
- **`[...arr].sort()`**, never `toSorted` — SWC does not polyfill it and it throws on iOS 15.

## Knowledge, log, schedule

Lower value, and none has a public consumer today.

- **log** — `LogDetailsContent` is *already* mounted by three surfaces. It just leaks context
  (`useQueryState('tab')`, `useRouter`, `usePermissionConfig`). Fixing those three is most of the
  migration; it is the cheapest win after tables.
- **knowledge** — `KnowledgeBaseProps` is `{ id, knowledgeBaseName?, workspaceId? }`, so it
  structurally cannot leave the workspace. It also writes unnamespaced nuqs keys
  (`?addConnector/?page/?q/?enabled`) that pollute the host URL when embedded — `host` fixes that.
- **schedule** — smallest surface; do it last or fold it into whichever PR is already open.

## Why workflow is not a resource

`w/[workflowId]/workflow.tsx` calls `joinWorkflow()` **only** when `embedded` is true, so there
`embedded` *adds* socket lifecycle rather than removing chrome — the opposite of every other use of
the flag. A workflow is a live collaborative session, not a document with an address. Forcing it into
`source`/`grants`/`host` would model the socket as an addressing concern, which it is not. Revisit
only with a deliberate design for collaborative sessions.

## Consolidation still owed inside the interfaces feature

An audit of the change set confirmed these against the working tree. They are duplication the
diff *added*, not inherited, and each has one obvious home:

- **Picker copy and list wiring.** `"Select a workflow"` / `"Search workflows..."` /
  `"No workflows in this workspace"` is spelled five times, and the three list queries
  (`useWorkflows`/`useTablesList`/`useWorkspaceFiles`) are wired in both the inspector's
  `ResourcePickerField` and the canvas's `ModuleResourcePicker`. One copy source; the field
  takes a `kind` instead of four copy props.
- **`createFormField`** is byte-identical in the inspector and the canvas form module — and one
  copy carries a comment promising the very invariant only a shared function delivers.
- **`toFieldErrorDetails`** is byte-identical across the two form-submit routes; the 400 wire
  shape should have one definition.
- **Interface grid geometry** is declared in two components (`--cell-*` and `--pane-*`) while
  `module-chrome.ts` exists to own it.
- **Unavailability copy** for the file and table modules is hand-rolled where
  `source.unavailableCopy` is the declared home.

Three further findings were raised but never independently refuted (their verifier agents died
mid-run). Verify before acting on them: two barrel-style inconsistencies and one structural claim
about `apps/sim/resources/index.ts` re-export surface.

## Verification caveat worth knowing

`apps/sim/tsconfig.json` excludes `**/*.test.ts(x)`, so **test files are never typechecked**. A
stale literal in a test — a removed field, an old union member — produces no compile error, and
vitest only catches it when the value is *asserted against* rather than merely constructed. That
is how `manage: false` survived in two test files after the field was deleted from
`ResourceGrants`. When changing a shared type, grep the repo; do not trust a green tsc.

## Known gaps in what already shipped

Carry these into whichever PR touches the area:

- A `@`-mentioned video inside a **publicly shared** markdown document renders as a chip, not a
  player. The referenced-by-doc gate recognises embed URLs, not `sim:file/<id>` mentions, so the
  token does not grant that file at all. Fixing it means widening what a share token grants, plus
  media byte-sniffing and range support on the inline cascade — a security decision, not a bug fix.
- The interface's file module does not pass `onNavigate`, so mentions inside a file previewed in an
  interface module are inert. One line, once someone wants it.
- `webm` maps to `audio/webm` in `EXTENSION_TO_MIME`, so a WebM *video* is typed as audio. It still
  byte-serves correctly (both are media) but the wrong player element is chosen.
- `components/rich-markdown-editor/` moved as a unit and keeps its own flat internal layout, which is
  inconsistent with the rest of `file-view/`.
- The mothership keeps ~12 `Embedded*` components for kinds with no canonical view. Each disappears
  with its kind's migration; lower the `R1b` baseline as they go.
