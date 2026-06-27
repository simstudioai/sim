---
paths:
  - "apps/sim/app/workspace/*/settings/**"
  - "apps/sim/ee/**/components/**"
---

# Settings Pages

Every settings page renders through the shared **`SettingsPanel`** primitive
(`@/app/workspace/[workspaceId]/settings/components/settings-panel`). It owns the
page chrome so pages never hand-roll it: a fixed header bar (right-aligned
actions), a scroll region, and a centered `max-w-[48rem]` content column led by a
**title + description that come from navigation metadata**. Pages render only
their body.

Do NOT hand-roll any of these in a settings page — they are the panel's job:

- `<div className='flex h-full flex-col bg-[var(--bg)]'>` shell
- the header bar (`flex flex-shrink-0 … px-[16px] pt-[8.5px] pb-[8.5px]`)
- the scroll container (`min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]`)
- the content column (`mx-auto … max-w-[48rem] … gap-7`)
- a title block (`<h1 className='font-medium text-[var(--text-body)] text-lg'>` + `<p className='text-[var(--text-muted)] text-md'>`)
- the page-level search input

## Canonical page shape

```tsx
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'

return (
  <SettingsPanel
    actions={
      <Chip leftIcon={Plus} variant='primary' onClick={onCreate}>
        Create
      </Chip>
    }
    search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search …' }}
  >
    {/* body only — sections, lists, forms */}
  </SettingsPanel>
)
```

When the page has modal/dialog siblings, wrap them with the panel in a fragment:

```tsx
return (
  <>
    <SettingsPanel actions={…}>{body}</SettingsPanel>
    <SomeModal … />
  </>
)
```

## `SettingsPanel` props

- `actions?: ReactNode` — right-aligned header chips. Wrap multiple in a fragment;
  the slot reserves the 30px chip height even when empty, so vertical rhythm is
  identical across pages. Conditional actions are fine: `actions={canManage && <Chip…/>}`.
- `search?: { value; onChange: (value: string) => void; placeholder?; disabled? }` —
  renders the canonical search field directly below the title. Pass `setSearchTerm`
  straight to `onChange`. Use this for a standalone search; if search shares a row
  with other controls (sort, filters, a date picker), render that whole row in
  `children` instead and omit the prop.
- `title?` / `description?` — overrides for the nav-driven defaults. **Only** for a
  detail sub-view that needs a different heading; normal pages never pass these.
- `scrollContainerRef?: React.Ref<HTMLDivElement>` — forwards a ref to the scroll
  region (e.g. programmatic scroll-to-bottom).
- `contentClassName?` — layout/spacing only; reach for it rarely. Prefer the
  default `gap-7`.

## Title + description live in navigation metadata

`apps/sim/app/workspace/[workspaceId]/settings/navigation.ts` is the single source
of truth. Every `NavigationItem` carries a one-line `description`; `SettingsPanel`
resolves both via `getSettingsSectionMeta(section)` and the
`SettingsSectionProvider` the settings shell wraps around the active section.

Adding a new settings page:

1. Add the `SettingsSection` id + a `NavigationItem` (with `label` **and**
   `description`) in `navigation.ts`. Keep descriptions verb-first, one line,
   ~40–55 chars, in the product voice (see `.claude/rules/constitution.md`).
2. Render the component inside the shell's `effectiveSection` switch in
   `settings/[section]/settings.tsx`.
3. Build the component body inside `<SettingsPanel>` — no shell, no title block.

## Other shared settings primitives (do not re-roll these)

- **`SettingsEmptyState`** (`…/components/settings-empty-state`) — the canonical
  muted status message. `variant='fill'` (default) centers in the available
  height (empty list, or a not-entitled/loading gate); `variant='inline'` sits in
  flow (a search "no results"). Never hand-roll
  `<div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>`
  or `<div className='py-4 text-center …'>`. It owns the `--text-muted` + `text-sm`
  tokens, so it also keeps these messages consistent across pages.
- **`RowActionsMenu`** (`…/components/row-actions-menu`) — the trailing `...`
  actions menu for a list row. Pass `label` (aria-label) and
  `actions: RowAction[]` (`{ label, onSelect, destructive?, disabled? }`); the
  component renders the canonical flush `...` trigger + `DropdownMenuContent`.
  Conditional items become array spreads: `...(canManage ? [{…}] : [])`. Never
  hand-roll the `<DropdownMenu>` + `<MoreHorizontal>` trigger per page.

## Detail sub-views (the one exception)

A drill-down view reached from a list row (selected MCP server, workflow MCP
server, credential set, permission group) keeps its **own** chrome because it
needs a left-aligned back button (`<Chip leftIcon={ArrowLeft}>`), which the panel
header (right-actions only) does not model. Leave those returns as hand-rolled
shells; only the list/main view uses `SettingsPanel`. Gate/early-return states
(not-entitled, loading, upgrade prompts) also stay as-is.

## Audit checklist

A settings page is design-system-clean when:

- [ ] Its main return is a `<SettingsPanel>` (or `<>…<SettingsPanel>…</>` with modal siblings) — no hand-rolled shell/header/scroll/column.
- [ ] It renders **no** hand-rolled `<h1>`/description title block — the title comes from nav metadata.
- [ ] Header chips are in `actions`; a standalone search is in the `search` prop.
- [ ] Its `NavigationItem` has an accurate, consistent-length `description`.
- [ ] Detail sub-views and entitlement/loading gates keep their own chrome (intentional).
- [ ] No business logic, handlers, or conditional rendering changed by the migration.
- [ ] `tsc`, `biome`, and the page's tests pass.
