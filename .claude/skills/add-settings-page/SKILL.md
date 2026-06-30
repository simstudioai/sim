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
- Nav metadata (titles + descriptions): `apps/sim/app/workspace/[workspaceId]/settings/navigation.ts`
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
5. **Verify:** `cd apps/sim && bunx tsc --noEmit`; `bunx biome check --write <file>`.

## Mode B — Audit existing settings pages

For each page component, confirm the checklist in `.claude/rules/sim-settings-pages.md`:

1. Find hand-rolled shells that should be `SettingsPanel`:
   `git grep -n "flex h-full flex-col bg-\[var(--bg)\]" -- 'apps/sim/**/settings/' 'apps/sim/ee/'`
   — every match should be either `settings-panel.tsx`, a **detail sub-view**
   (has a `<Chip leftIcon={ArrowLeft}>` back button), or an entitlement/loading
   **gate** early-return. Anything else is a page that still needs migrating.
2. Find hand-rolled title blocks (should be 0 outside detail views):
   `git grep -n "text-\[var(--text-body)\] text-lg" -- 'apps/sim/**/settings/' 'apps/sim/ee/'`
3. Confirm each page imports `SettingsPanel` and that its `NavigationItem` has an
   accurate `description` of consistent length with its peers.
   - Editable pages: confirm Save/Discard go through `SaveDiscardActions` and
     dirty is wired via `useSettingsUnsavedGuard` (called before early-return
     gates) — flag any hand-rolled Save button, `beforeunload`, or unsaved modal.
     `git grep -n "beforeunload" -- 'apps/sim/**/settings/' 'apps/sim/ee/'`
     should only hit the centralized `use-settings-before-unload.ts`.
4. When migrating a page, change ONLY the structural shell→`SettingsPanel` swap:
   move header chips to `actions`, the standalone search to `search`, delete the
   `<h1>` title block, replace the three closing `</div>` (column/scroll/shell)
   with `</SettingsPanel>`, and keep modal siblings in a `<>` fragment. Do NOT
   touch handlers, state, queries, conditional rendering, or detail/gate returns.
   Drop per-page `gap-*`/`pt-*` on the content column in favor of the panel default.
5. Remove now-unused imports (`ChipInput`/`Search`) ONLY after grepping that
   they are not still used elsewhere in the file (e.g. by a detail view).
6. **Verify the whole sweep:** `tsc --noEmit`, `biome check` on every touched
   file, and run the affected pages' tests. Diff each file against the base and
   confirm the change is purely structural before shipping.
