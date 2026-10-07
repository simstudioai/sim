---
name: add-settings-page
description: Add a new Sim settings page, or audit existing settings pages for design-system compliance with the shared SettingsPanel layout. Use when creating a settings tab, or when asked to check/clean up settings pages so they match the design system (consistent title, header, search, spacing).
---

# Settings Page (add / audit)

Settings page chrome (header bar, scroll region, content column, nav-driven
title + description) is owned by the `settings/[section]/layout.tsx` shell. Each
page renders through **`SettingsPanel`**, which registers the page's header data
(actions, search, back) with that shell and renders only the body. The full
convention lives in `.claude/rules/sim-settings-pages.md` — read it first; this
skill is the procedure.

Key paths:
- Chrome shell: `apps/sim/app/workspace/[workspaceId]/settings/[section]/layout.tsx` (`SettingsHeaderShell`)
- `SettingsPanel` registrar: `apps/sim/components/settings/settings-panel.tsx`
- Nav metadata (titles + descriptions): `apps/sim/components/settings/navigation.ts`
- Section switch + provider: `apps/sim/app/workspace/[workspaceId]/settings/[section]/settings.tsx`
- Pages: `apps/sim/app/workspace/[workspaceId]/settings/components/<name>/<name>.tsx` and EE pages under `apps/sim/ee/<feature>/components/`

## Mode A — Add a new settings page

1. **Navigation.** In `navigation.ts`: add the id to `UnifiedSettingsSection`, then a
   `SETTINGS_SECTION_REGISTRY` entry with `label`, `icon`, and
   `unified: { id, description, group, order }` (description verb-first, ~40–55 chars,
   product voice per `.claude/rules/constitution.md`). Set gating flags
   (`requiresHosted`, `requiresEnterprise`, …) on `unified`, and add `planes` only if the
   section also exists on a standalone plane.
2. **Wire the switch.** Register the module in `SECTION_MODULES`
   (`settings/section-warmers.ts`), then add
   `const X = dynamic(() => SECTION_MODULES.x().then((m) => m.X))` and its case in the
   `effectiveSection` switch in `settings/[section]/settings.tsx`.
3. **Build the body inside `SettingsPanel`** per the rule's canonical page shape:
   `actions`, `search`, `children`, modal siblings in a fragment.
4. **If the page has editable state**, wire the shared save/discard stack exactly as in
   `.claude/rules/sim-settings-pages.md` "Save / Discard + unsaved-changes guard"
   (`saveDiscardActions()`, `useSettingsUnsavedGuard` before any early return).
5. **Verify:** the local gate in the root `CLAUDE.md` ("How your work is checked").

## Mode B — Audit existing settings pages

For each page component, confirm the checklist in `.claude/rules/sim-settings-pages.md`:

Each grep lists candidates; review every match against the expected ones named below.

1. Find hand-rolled shells that should be `SettingsPanel`:
   `git grep -n "flex h-full flex-col bg-\[var(--bg)\]" -- 'apps/sim/**/settings/**' 'apps/sim/ee/'`
   — expected matches: the workspace and organization `settings/layout.tsx` shells and the
   shared header shell (`components/settings/settings-header.tsx`); an entitlement/loading gate
   is also fine. `CredentialDetailLayout` (the `settings/secrets/[credentialId]` exception) is
   an exempt hand-rolled shell outside these pathspecs. A detail sub-view is never a match: it
   passes `back={{ text, icon: ArrowLeft, onSelect }}` to `SettingsPanel`. Anything else is a
   violation: render it through `SettingsPanel`.
2. Find hand-rolled title blocks:
   `git grep -n "text-\[var(--text-body)\] text-lg" -- 'apps/sim/**/settings/**' 'apps/sim/ee/'`
   — the only title is the `<h1>` in `settings-header.tsx`; a non-heading value at that size
   (e.g. the credit balance in `ee/organization-usage/components/usage-credits.tsx`) is fine.
3. Find literal pixel text sizes (should be 0 — see "Text Scale" in
   `.claude/rules/sim-styling.md`):
   `git grep -nE "text-\[1[0-8]px\]" -- 'apps/sim/**/settings/**' 'apps/sim/ee/'`.
   Display type above the scale (`text-[40px]` hero headings) is deliberate and out of
   scope.
4. Confirm each page imports `SettingsPanel` and that its registry entry has an
   accurate `description` of consistent length with its peers.
   - Editable pages: confirm Save/Discard go through `saveDiscardActions()` and
     dirty is wired via `useSettingsUnsavedGuard` (called before early-return
     gates) — flag any hand-rolled Save button, `beforeunload`, or unsaved modal.
     `git grep -n "beforeunload" -- 'apps/sim/**/settings/**' 'apps/sim/ee/' 'apps/sim/components/settings/' ':(exclude,glob)**/*.test.*'`
     should only hit the centralized `use-settings-browser-navigation.ts`.
5. Fix each finding with the smallest structural change that satisfies the checklist;
   do not touch handlers, state, queries, or gate returns. A pixel-size fix swaps
   only the size class for its exact-pixel token (`text-[12px]` → `text-caption`).
6. **Verify the whole sweep:** the local gate in the root `CLAUDE.md`, plus the
   affected pages' tests. Diff each file against the base and confirm the change is
   purely structural before shipping.

## Mode C — Migrate list rows to `SettingsResourceRow`

Read "The resource row" in `.claude/rules/sim-settings-pages.md` first — it is the
contract. Then, per page:

1. Find hand-rolled rows:
   `git grep -n "truncate text-\[var(--text-body)\] text-sm" -- 'apps/sim/app/workspace/' 'apps/sim/ee/'`
   Every match outside `settings-resource-row.tsx` is either a row to migrate or a
   genuinely different shape (multi-line body, tabular columns, a grid) that stays
   bespoke — decide which, and say so.
2. Convert the row and its wrapper per "The resource row" (props, `trailing` vs
   `badge`, bleed, `navigable`/`clickLabel`). Unlike Mode B, this conversion **may**
   change conditional rendering (a permission gate becomes
   `onClick={can ? … : undefined}` + `navigable={can}`); verify the gated state has no
   clickable affordance left.
3. Check what the hand-rolled row rendered *beside* the title (a badge, a timestamp, a
   transport label). The row's title truncates as one unit, so anything folded
   into it can be ellipsised away — move it to `description` or `badge`.
4. Verify: the local gate, the page's tests, and a diff read of
   every converted block for lost props, conditions, and `key` placement.
