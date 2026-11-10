---
name: add-settings-page
description: Add or audit the account and self-hosted settings pages that use SettingsPanel. Use implement-platform for Platform organization and workspace Settings.
---

# Settings Page (add / audit)

For Platform Settings (`apps/sim/app/(product)/**`, `apps/sim/platform/**`), use [implement-platform](../implement-platform/SKILL.md). In a mixed request, apply the steps below only to the account and self-hosted settings.

Settings page chrome (header bar, scroll region, content column, nav-driven
title + description) is owned by `StandaloneSettingsShell`, which the account and
self-hosted `settings/layout.tsx` mount. Each
page renders through **`SettingsPanel`**, which registers the page's header data
(actions, search, back) with that shell and renders only the body. The full
convention lives in `.claude/rules/sim-settings-pages.md` — read it first; this
skill is the procedure.

Key paths:
- Chrome shell: `apps/sim/components/settings/standalone-settings-shell.tsx` (`SettingsHeaderShell` from `settings-header.tsx`), mounted by `apps/sim/app/(site)/account/settings/layout.tsx` and `apps/sim/app/(site)/selfhost/settings/layout.tsx`
- `SettingsPanel` registrar: `apps/sim/components/settings/settings-panel.tsx`
- Nav metadata (titles + descriptions): `apps/sim/components/settings/navigation.ts`
- Section switch: `apps/sim/components/settings/account-settings-renderer.tsx` and `selfhost-settings-renderer.tsx`
- Pages: `apps/sim/components/settings/sections/<name>/<name>.tsx` and EE pages under `apps/sim/ee/<feature>/components/`

## Mode A — Add a new settings page

1. **Navigation.** In `navigation.ts`: add the id to `UnifiedSettingsSection`, then a
   `SETTINGS_SECTION_REGISTRY` entry with `label`, `icon`, and
   `unified: { id, description, group, order }` (description verb-first, ~40–55 chars,
   product voice per `.claude/rules/constitution.md`). Set gating flags
   (`requiresHosted`, `requiresEnterprise`, …) on `unified`, and add `planes` only if the
   section also exists on a standalone plane.
2. **Wire the switch.** In the plane's renderer (`account-settings-renderer.tsx` or
   `selfhost-settings-renderer.tsx`), add
   `const X = dynamic(() => import('@/components/settings/sections/<name>/<name>').then((m) => m.X))`
   and its branch.
3. **Build the body inside `SettingsPanel`** per the rule's canonical page shape:
   `actions`, `search`, `children`, modal siblings in a fragment.
4. **If the page has editable state**, wire the shared save/discard stack exactly as in
   `.claude/rules/sim-settings-pages.md` "Save / Discard + unsaved-changes guard"
   (Save/Discard as header actions, `useSettingsUnsavedGuard` before any early return).
5. **Verify:** the local gate in the root `CLAUDE.md` ("How your work is checked").

## Mode B — Audit existing settings pages

For each page component, confirm the checklist in `.claude/rules/sim-settings-pages.md`:

Each grep lists candidates; review every match against the expected ones named below.

1. Find hand-rolled shells that should be `SettingsPanel`:
   `git grep -n "flex h-full flex-col bg-\[var(--bg)\]" -- 'apps/sim/**/settings/**' 'apps/sim/ee/' ':(exclude)apps/sim/platform/**'`
   — expected match: the shared header shell (`components/settings/settings-header.tsx`); an
   entitlement/loading gate is also fine. A detail sub-view is never a match: it
   passes `back={{ text, icon: ArrowLeft, onSelect }}` to `SettingsPanel`. Anything else is a
   violation: render it through `SettingsPanel`.
2. Find hand-rolled title blocks:
   `git grep -n "text-\[var(--text-body)\] text-lg" -- 'apps/sim/**/settings/**' 'apps/sim/ee/' ':(exclude)apps/sim/platform/**'`
   — the only title is the `<h1>` in `settings-header.tsx`; a non-heading value at that size
   (e.g. a metric value in `components/settings/sections/mothership/mothership.tsx`) is fine.
3. Find literal pixel text sizes (should be 0 — see "Text Scale" in
   `.claude/rules/sim-styling.md`):
   `git grep -nE "text-\[1[0-8]px\]" -- 'apps/sim/**/settings/**' 'apps/sim/ee/' ':(exclude)apps/sim/platform/**'`.
   Display type above the scale (`text-[40px]` hero headings) is deliberate and out of
   scope.
4. Confirm each page imports `SettingsPanel` and that its registry entry has an
   accurate `description` of consistent length with its peers.
   - Editable pages: confirm Save/Discard are header actions (`id: 'discard'`, a primary Save) and
     dirty is wired via `useSettingsUnsavedGuard` (called before early-return
     gates) — flag any hand-rolled Save button, `beforeunload`, or unsaved modal.
     `git grep -n "beforeunload" -- 'apps/sim/**/settings/**' 'apps/sim/ee/' 'apps/sim/components/settings/' ':(exclude)apps/sim/platform/**' 'apps/sim/hooks/use-settings-browser-navigation.ts' ':(exclude,glob)**/*.test.*'`
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
   `git grep -n "truncate text-\[var(--text-body)\] text-sm" -- 'apps/sim/components/' 'apps/sim/ee/'`
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
