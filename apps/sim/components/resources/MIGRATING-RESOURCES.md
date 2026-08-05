# Migrating a resource onto the resource layer

Follow-up work after the file resource was moved onto the three axes, and the table's
view layer was moved out of its route.

This is the playbook for making a resource — a table, a knowledge base, a log, a scheduled task —
render the same way everywhere: on its own page, in a chat/mothership tab, and on a public
share. Read `.claude/rules/sim-resource-views.md` first; that is the rule.
This is the migration plan.

## Where things stand

| Resource | Canonical view | Consumers today | Notes |
| --- | --- | --- | --- |
| **file** | `components/resources/file-view` | Files page, mothership panel, `/f/[token]` | Done. The reference implementation, and the only kind with a public surface. |
| **table** | *view layer only* (`components/resources/table-view`) | tables page + mothership, via the editing shell that mounts its parts | Moved out of the route tree; no standalone read-only view has a consumer yet. |
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

Never reimplement. A hand-rolled read-only copy, written because the real view had no seam, loses
every renderer the original already handles — booleans, JSON, dates, links, resource chips, pinned
columns, windowing — and then drifts. Adding the seam is always cheaper than the second copy.

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
`app/api/files/public/[token]/**`, which resolves the share first and never trusts a client id.

### 6. Register and ratchet

Add the unit to `CANONICAL_UNITS`. Migrate every consumer in the same PR. Lower the `R1b`
(`shadowNamedComponents`) baseline as each `Embedded*` component for that kind disappears.

---

## Table — the next one, and the one that pays

Everything above is abstract until a resource with no existing seam goes through it. Tables is where
the ledger turns — the view layer has moved, and the read-only view lands with its first consumer.

**What it buys**

- Any surface that needs to *read* a table mounts one view and gains every cell renderer, instead of
  hand-rolling a copy that loses most of them.
- Tables become publicly shareable once a token-scoped rows route exists.
- The mothership stops mounting the entire tables route page to show a table.

**Why it is hard**

`tables/[tableId]/components/table-grid/table-grid.tsx` is ~3,963 lines with no component tests and
live collaborative editing. It reads `useParams()`, `useUserPermissionsContext()`, and roughly
fourteen authenticated mutation hooks.

**The good news:** the cell layer is *already* factored correctly. `cells/cell-render.tsx` splits into
a pure `resolveCellRender()` returning a typed `CellRenderKind` union and a dumb `<CellRender/>`;
`cells/cell-content.tsx` is only glue plus the inline editor. That split is the model for the rest.

### What actually happened

The move and the axes landed together. Two corrections to the plan below, learned by doing it:

- **`table-grid.tsx` never moved, and did not need to.** It reads `useParams()`,
  `useUserPermissionsContext()` and ten mutation hooks — it *is* the shell. Only what
  it renders moved out from under it: 18 files, ~3.4k lines, at ~100% rename
  similarity. Splitting the grid was never a prerequisite for giving the view layer
  an address.
- **The move needed four unblocking changes first**, each worth landing alone:
  `StatusBadge` out of `logs/utils` (it dragged the block registry into every table
  cell), `ChatMessageContext` read from its definition, `RemoteTableSelection` lifted
  out of the presence hook, and `CellContent` taking an `editor` slot instead of
  importing `InlineEditor` — with no `sideEffects: false`, that static import shipped
  the write path regardless of `isEditing`.

Still open: the public surface (a token-scoped rows route plus a seed — see step 5),
the mothership panel (still mounts the whole editing page — a product decision, not a
refactor), and the row page-size split documented on `TABLE_VIEW_PAGE_SIZE`.

### Original sequencing — three PRs, not one

**Step 1 — move, no behaviour change.** Relocate the presentational subtree to
`components/resources/table-view/`: `TableColGroup`, headers, `DataRow`, `cells/` (minus
`InlineEditor` and `ExpandedCellPopover`), and the virtualizer wiring. Keep the editing shell in
`tables/[tableId]/`. Nothing renders differently. Land this alone so the diff is reviewable.

**Step 2 — add the read-only view.** Not yet done: no surface mounts a standalone read-only table, so
there is no `TableView`. When one appears it takes `{ source, grants, host }` and resolves rows and
schema from the source — workspace scope on the existing `tableKeys` factory, and a share arm only
once step 3 gives it a route to read. It replaces every hand-rolled read-only copy, which is the
point of adding it at all.

*Corrected while doing it:* this section used to claim the page and an embedded table "should hit one
cache entry, and forking that doubles every fetch". Half right. The **schema** is keyed on the table
id alone, so it genuinely is one entry everywhere. **Rows** are not, and should not be: `pageSize` is
in the key, the page pulls 1000-row pages so `ensureAllRowsLoaded` can drain for select-all/export in
few round trips, and a panel wants a fast first screen and never drains. One number would either make
a chat panel fetch 1000 rows to show ten, or make every bulk operation ten times the requests.

**Step 3 — public surface.** Token-scoped rows route, `ResourceSeedMap['table']` widened from
`never` to carry the column schema, and a surface to mount it on.

### Watch out for

- **`resolveCellRender` takes `currentWorkspaceId`** — now asserted in
  `table-view/cells/cell-render.test.ts`, which fails if the guard is removed. It emits a
  `sim-resource` chip for in-workspace URLs. `SimResourceCell` then fetches workspace lists to resolve names. In share scope pass
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
- `webm` maps to `audio/webm` in `EXTENSION_TO_MIME`, so a WebM *video* is typed as audio. It still
  byte-serves correctly (both are media) but the wrong player element is chosen.
- `components/rich-markdown-editor/` moved as a unit and keeps its own flat internal layout, which is
  inconsistent with the rest of `file-view/`.
- The mothership keeps 8 `Embedded*` components for kinds with no canonical view. Each disappears
  with its kind's migration; lower the `R1b` baseline as they go.
