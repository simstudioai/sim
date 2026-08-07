---
name: add-settings-page
description: Add a new Sim settings page, or audit existing settings pages for design-system compliance with the shared SettingsPanel layout. Use when creating a settings tab, or when asked to check/clean up settings pages so they match the design system (consistent title, header, search, spacing).
---

# Settings Page (add / audit)

Sim settings pages all render through the shared **`SettingsPanel`** primitive,
which owns the page chrome and renders a nav-driven title + description. The full
convention lives in `.claude/rules/sim-settings-pages.md` — read it first; this
skill is the procedure.

Key paths:
- Layout primitive: `apps/sim/app/workspace/[workspaceId]/settings/components/settings-panel/settings-panel.tsx`
- Nav metadata (titles + descriptions): `apps/sim/components/settings/navigation.ts`
- Section switch + provider: `apps/sim/app/workspace/[workspaceId]/settings/[section]/settings.tsx`
- Pages: `apps/sim/app/workspace/[workspaceId]/settings/components/<name>/<name>.tsx` and EE pages under `apps/sim/ee/<feature>/components/`

## Mode A — Add a new settings page

1. **Navigation.** In `navigation.ts`: add the id to the `SettingsSection` union,
   then a `NavigationItem` with `label` AND a one-line `description` (verb-first,
   ~40–55 chars, product voice per `.claude/rules/constitution.md`). Place it in
   the right `section` group and set any gating flags (`requiresHosted`,
   `requiresEnterprise`, etc.).
2. **Wire the switch.** Add the component to the `effectiveSection` render switch
   in `settings/[section]/settings.tsx` (lazy `dynamic(...)` like its siblings).
3. **Build the body inside `SettingsPanel`.** Never hand-roll the shell, header
   bar, scroll region, content column, or title block. Put header buttons in
   `actions`, a standalone search in `search={{ value, onChange, placeholder }}`,
   and the page content as `children`. Modals go beside the panel inside a `<>`.
4. **If the page has editable state**, wire the shared save/discard stack — put
   `SaveDiscardActions` (dirty-gated Discard+Save chips) in `actions`, and call
   `useSettingsUnsavedGuard({ isDirty })` **before any early-return gate**.
   Detail sub-views additionally route the back chip through
   `guard.guardBack(closeFn)` and render the shared `UnsavedChangesModal`. Never
   hand-roll a Save button, a `beforeunload`, or an "Unsaved changes" modal —
   they're centralized. See the "Save / Discard + unsaved-changes guard" section
   in `.claude/rules/sim-settings-pages.md`.
5. **Verify:** `cd apps/sim && bun run type-check`; `bunx biome check --write <file>`.

## Mode B — Audit existing settings pages

For each page component, confirm the checklist in `.claude/rules/sim-settings-pages.md`:

1. Find hand-rolled shells that should be `SettingsPanel`:
   `git grep -n "flex h-full flex-col bg-\[var(--bg)\]" -- 'apps/sim/**/settings/' 'apps/sim/ee/'`
   — every match should be either `settings-panel.tsx`, a **detail sub-view**
   (has a `<Chip leftIcon={ArrowLeft}>` back button), or an entitlement/loading
   **gate** early-return. Anything else is a page that still needs migrating.
2. Find hand-rolled title blocks (should be 0 outside detail views):
   `git grep -n "text-\[var(--text-body)\] text-lg" -- 'apps/sim/**/settings/' 'apps/sim/ee/'`
3. Find literal pixel text sizes (should be 0 — see "Text-scale tokens" in
   `.claude/rules/sim-settings-pages.md` for the token map and the row
   title/subtitle pairing convention):
   `git grep -nE "text-\[1[0-8]px\]" -- 'apps/sim/**/settings/' 'apps/sim/ee/'` — should
   be 0. Display type above the scale (`text-[40px]` hero headings, the `text-[8px]`
   member-avatar initial) is deliberate and out of scope.
4. Confirm each page imports `SettingsPanel` and that its `NavigationItem` has an
   accurate `description` of consistent length with its peers.
   - Editable pages: confirm Save/Discard go through `SaveDiscardActions` and
     dirty is wired via `useSettingsUnsavedGuard` (called before early-return
     gates) — flag any hand-rolled Save button, `beforeunload`, or unsaved modal.
     `git grep -n "beforeunload" -- 'apps/sim/**/settings/' 'apps/sim/ee/'`
     should only hit the centralized `use-settings-before-unload.ts`.
5. When migrating a page, change ONLY the structural shell→`SettingsPanel` swap:
   move header chips to `actions`, the standalone search to `search`, delete the
   `<h1>` title block, replace the three closing `</div>` (column/scroll/shell)
   with `</SettingsPanel>`, and keep modal siblings in a `<>` fragment. Do NOT
   touch handlers, state, queries, conditional rendering, or detail/gate returns.
   Drop per-page `gap-*`/`pt-*` on the content column in favor of the panel default.
6. When fixing literal pixel text sizes, replace ONLY the size class with its
   exact-pixel-equivalent named token (e.g. `text-[12px]` → `text-caption`,
   never a different size) — this must render pixel-identical, not restyle the
   page. Leave color tokens (`--text-primary` vs `--text-body`, etc.) untouched
   unless they're also being changed for an unrelated, deliberate reason.
7. Remove now-unused imports (`ChipInput`/`Search`) ONLY after grepping that
   they are not still used elsewhere in the file (e.g. by a detail view).
8. **Verify the whole sweep:** `bun run type-check`, `biome check` on every touched
   file, and run the affected pages' tests. Diff each file against the base and
   confirm the change is purely structural before shipping.

## Mode C — Migrate list rows to `SettingsResourceRow`

Read "The resource row" in `.claude/rules/sim-settings-pages.md` first — it is the
contract. Then, per page:

1. Find hand-rolled rows:
   `git grep -n "truncate text-\[var(--text-body)\] text-sm" -- 'apps/sim/app/workspace/' 'apps/sim/ee/'`
   Every match outside `settings-resource-row.tsx` is either a row to migrate or a
   genuinely different shape (multi-line body, tabular columns, a grid) that stays
   bespoke — decide which, and say so.
2. Replace the row *and* its wrapper: a `<button>`/`<Link>` around the row becomes
   `onClick`/`href` on the row itself. Wrapping the row is what the primitive
   exists to stop — it is also invalid HTML once `trailing` holds a control.
3. Sort the trailing content: interactive → `trailing`, decorative → `badge`.
   Getting this backwards makes the row's right edge a dead zone.
4. Add `navigable` only if the row opens a detail page, and `clickLabel` always.
5. Drop the container's `-mx-2` — the row now owns the bleed. Use
   `RESOURCE_LIST_STACK` / `RESOURCE_LIST_GRID`; do not hand-write the gap.
6. Unlike Mode B, this migration **may** change conditional rendering: a
   `<button disabled={!can}>` becomes `onClick={can ? … : undefined}` +
   `navigable={can}`, which renders a plain non-interactive row. Verify the gated
   state has no clickable affordance left.
7. Check what the old row rendered *beside* the title (a badge, a timestamp, a
   transport label). The row's title truncates as one unit, so anything folded
   into it can be ellipsised away — move it to `description` or `badge`.
8. Verify: `bun run type-check`, `biome check`, the page's tests, and a diff read of
   every converted block for lost props, conditions, and `key` placement.
