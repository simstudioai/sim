---
name: add-settings-page
description: Add a new Sim settings page, or audit existing settings pages for design-system compliance with the shared SettingsPanel layout. Use when creating a settings tab, or when asked to check/clean up settings pages so they match the design system (consistent title, header, search, spacing).
---

# Settings Page (add / audit)

Sim settings pages render their bodies through the shared **`SettingsPanel`**
registrar, which publishes header metadata and actions to the active
`SettingsHeaderShell`. The shell owns and renders the page chrome, including the
registry-driven title and description. The full convention lives in
`.claude/rules/sim-settings-pages.md` — read it first; this skill is the
procedure.

Key paths:
- Panel registrar implementation: `apps/sim/components/settings/settings-panel.tsx`
- Established section-component import: `@/app/workspace/[workspaceId]/settings/components/settings-panel` (compatibility barrel)
- Section types + registry: `apps/sim/components/settings/navigation.ts`
- Account renderer: `apps/sim/components/settings/account-settings-renderer.tsx`
- Account route gate: `apps/sim/app/account/settings/[section]/page.tsx`
- Organization renderer: `apps/sim/components/settings/organization-settings-renderer.tsx`
- Organization route gate: `apps/sim/app/organization/[organizationId]/settings/[section]/page.tsx`
- Workspace metadata adapter: `apps/sim/app/workspace/[workspaceId]/settings/navigation.ts`
- Workspace renderer + provider: `apps/sim/app/workspace/[workspaceId]/settings/[section]/settings.tsx`
- Workspace route gate: `apps/sim/app/workspace/[workspaceId]/settings/[section]/page.tsx`
- Pages: `apps/sim/app/workspace/[workspaceId]/settings/components/<name>/<name>.tsx` and EE pages under `apps/sim/ee/<feature>/components/`
- Browser acceptance maintenance: `apps/sim/e2e/MAINTENANCE.md`

## Mode A — Add a new settings page

1. **Registry.** In `apps/sim/components/settings/navigation.ts`, add the id to
   `UnifiedSettingsSection` and add a `SettingsSectionRegistryEntry` to
   `SETTINGS_SECTION_REGISTRY`. Its mandatory `unified` projection owns the
   default description and workspace gating flags (`requiresHosted`,
   `requiresEnterprise`, etc.). For each plane-specific projection the page
   needs, also add the id to `AccountSettingsSection`,
   `OrganizationSettingsSection`, or `WorkspaceSettingsSection` and add that
   optional projection. Use plane-specific copy only when its scope genuinely
   differs. Keep descriptions verb-first, one line, ~40–55 chars, in the product
   voice (see `.claude/rules/constitution.md`).
2. **Always wire the unified workspace surface.** Every registry entry
   participates in unified workspace navigation before its gates are applied,
   whether or not it has `planes.workspace`. Render the `unified.id` in the
   workspace `settings/[section]/settings.tsx` switch so an allowed route cannot
   resolve to a blank page.
3. **Wire optional standalone planes.** If the entry declares `planes.account`
   or `planes.organization`, add the component to
   `account-settings-renderer.tsx` or `organization-settings-renderer.tsx`.
   Never declare a standalone projection whose renderer cannot render it.
4. **Preserve every route gate.** In the workspace
   `settings/[section]/page.tsx`, classify the unified section in
   `WORKSPACE_SECTION_MAP` or `ORGANIZATION_SECTION_MAP` when it belongs to
   either access plane; otherwise add an explicit direct gate when needed or
   verify that host-context membership is the intended boundary. Enforce the
   section's permission, deployment, plan, and entitlement outcome. For
   standalone account or organization projections, also update their
   `[section]/page.tsx` gate and the shared organization access/feature helpers
   when applicable. Sidebar gating never replaces server authorization.
5. **Build the body inside `SettingsPanel`.** Never hand-roll the shell, header
   bar, scroll region, content column, or title block. Put header buttons in
   `actions`, a standalone search in `search={{ value, onChange, placeholder }}`,
   and the page content as `children`. Modals go beside the panel inside a `<>`.
6. **If the page has editable state**, wire the shared save/discard stack — put
   `SaveDiscardActions` (dirty-gated Discard+Save chips) in `actions`, and call
   `useSettingsUnsavedGuard({ isDirty })` **before any early-return gate**.
   Detail sub-views additionally route the back chip through
   `guard.guardBack(closeFn)` and render the shared `UnsavedChangesModal`. Never
   hand-roll a Save button, a `beforeunload`, or an "Unsaved changes" modal —
   they're centralized. See the "Save / Discard + unsaved-changes guard" section
   in `.claude/rules/sim-settings-pages.md`.
7. **Update tests and browser contracts.** Update the shared navigation,
   workspace route/navigation, and access unit tests affected by the new
   projection or gate. Then follow `apps/sim/e2e/MAINTENANCE.md`: intended
   observable changes require paired literal Playwright contracts, while
   behavior-preserving refactors require focused verification without
   expectation churn.
8. **Verify:** From `apps/sim`, run `bunx tsc --noEmit` and
   `bunx biome check --write <file>` on changed source files. Then run the
   affected unit tests and the focused orchestrated E2E project from
   `e2e/README.md`.

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
   `git grep -n "text-\[1[0-8]px\]" -- 'apps/sim/**/settings/' 'apps/sim/ee/'`
4. Confirm each page imports `SettingsPanel` and that its
   `SettingsSectionRegistryEntry` has an accurate `unified.description` of
   consistent length with its peers, plus only the plane projections it
   supports.
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
8. **Verify the whole sweep:** `tsc --noEmit`, `biome check` on every touched
   file, and run the affected pages' tests. Diff each file against the base and
   confirm the change is purely structural before shipping.
