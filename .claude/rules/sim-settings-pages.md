---
paths:
  - "apps/sim/app/workspace/*/settings/**"
  - "apps/sim/ee/**/components/**"
---

# Settings Pages

The Next.js `settings/[section]/layout.tsx` owns all settings page chrome via
`SettingsHeaderShell` — a fixed header bar (a left back chip + right-aligned
action chips), a scroll region, and a centered `max-w-[48rem]` content column led
by a **title + description from navigation metadata**. The chrome stays mounted
across section navigation (it never re-renders or re-lays-out). Each section
renders through the **`SettingsPanel`** registrar
(`@/app/workspace/[workspaceId]/settings/components/settings-panel`), which feeds
the shell its header data and renders only the section body. Sections supply
**data**, never chrome.

Do NOT hand-roll any of these in a settings page — they are owned by the layout
shell (fed through `SettingsPanel`):

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
    actions={[{ text: 'Create', icon: Plus, variant: 'primary', onSelect: onCreate }]}
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

- `actions?: SettingsAction[]` — right-aligned header chips, **data only**:
  `{ text, icon?, variant?: 'primary'|'destructive', active?, onSelect, disabled?, tooltip? }`.
  The shell renders each as a `Chip` — never pass JSX, a `<div>`, or `className`
  (the locked contract: it's structurally impossible to vibe-code a padding
  change). Multiple/conditional actions are a plain array
  (`[...(canManage ? [{…}] : []), …]`). Labels are **sentence case** (`Add override`,
  not `Add Override`). A disabled action that needs to explain itself sets
  `tooltip` (the shell renders the hover tooltip, disabled chip included) — never
  hand-roll a tooltip-wrapped chip in `aside`. Save/Discard pairs come from the
  `saveDiscardActions()` helper (spread it into `actions`). Only a widget that
  genuinely cannot be a chip (e.g. one needing hover-prefetch) goes in `aside`.
- `back?: SettingsBackAction` (`{ text, icon?, onSelect }`) — left-aligned back
  chip for a **detail sub-view** (e.g. a selected MCP server, a permission group,
  a retention policy). Detail sub-views render through `SettingsPanel` like list
  pages — they do NOT hand-roll their own shell.
- `aside?: ReactNode` — escape hatch for the rare non-chip header widget. Keep it rare.
- `search?: { value; onChange: (value: string) => void; placeholder?; disabled? }` —
  renders the canonical search field directly below the title. Pass `setSearchTerm`
  straight to `onChange`. Use this for a standalone search; if search shares a row
  with other controls (sort, filters, a date picker), render that whole row in
  `children` instead and omit the prop.
- `title?` / `description?` — overrides for the nav-driven defaults. **Only** for a
  detail sub-view that needs a different heading; normal pages never pass these.
- `scrollContainerRef?: React.Ref<HTMLDivElement>` — forwards a ref to the scroll
  region (e.g. programmatic scroll-to-bottom).

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

## Text-scale tokens (no literal pixel sizes)

Settings pages never use a literal `text-[Npx]` class — always the named Tailwind
scale token from `apps/sim/tailwind.config.ts`'s `fontSize` extension (`text-micro`
10px, `text-xs` 11px, `text-caption` 12px, `text-small` 13px, `text-sm` 14px
[Tailwind default, unmodified], `text-base` 15px, `text-md` 16px, `text-lg` 18px
[Tailwind default]). A literal size is either a straight rename to the equivalent
token (if the pixel value matches one exactly) or a sign the page never migrated —
grep `text-\[1[0-8]px\]` under `apps/sim/app/workspace/*/settings/**` and
`apps/sim/ee/**` to find stragglers.

Watch `text-xs`: it is 11px here, so a "caption" written as `text-xs` is a pixel
short. See `sim-styling.md` for the full scale.

The two-line list row (title over a muted subtitle — a name + email, a tool name
+ description, a server name + status) is **not something you build**: it is
`SettingsResourceRow`, which owns the pairing
(`text-[var(--text-body)] text-sm` over `text-[var(--text-muted)] text-caption`).
See "The resource row" below.

For a toggle row (a `Switch` with a title and optional description), use the emcn
`Label` component for the title — never a hand-rolled `<span>` — paired with
`Switch`'s `id`/`Label`'s `htmlFor`:

```tsx
<div className='flex items-center justify-between'>
  <div className='flex flex-col gap-1'>
    <Label htmlFor='my-toggle'>Enable thing</Label>
    <p className='text-[var(--text-muted)] text-caption'>One-line description.</p>
  </div>
  <Switch id='my-toggle' checked={enabled} onCheckedChange={onToggle} />
</div>
```

`Label`'s own default styling (`font-medium text-[var(--text-primary)]
text-small`) already matches the established title treatment — do not add a
`className` overriding its size/color unless the row genuinely needs something
different.

`--text-primary`/`--text-secondary` and `--text-body`/`--text-muted` are both real,
independently-defined tokens (not interchangeable — they resolve to different
colors) and both see legitimate use across settings pages; this rule only pins
down the **row title/subtitle** shape above, not every text element on every page.

## The resource row

**`SettingsResourceRow`** (`…/components/settings-resource-row`) is *the* list row
for every settings resource — and for skills, integrations, and the `ee/` surfaces
too. It owns the tile, the title/subtitle tokens, the row padding and bleed
(`-mx-2 … rounded-lg p-2`), the hover band, the hit area, the focus ring, and the
navigation chevron. Never hand-roll any of it, and never wrap the row in your own
`<button>` or `<Link>` — that is what `onClick`/`href` are for.

```tsx
<div className={RESOURCE_LIST_STACK}>
  {items.map((item) => (
    <SettingsResourceRow
      key={item.id}
      icon={<Wrench className='text-[var(--text-icon)]' />}
      iconFilled
      title={item.name}
      description={item.summary}
      onClick={() => open(item.id)}   // or href={`…/${item.id}`}
      clickLabel={`Open ${item.name}`}
      navigable
    />
  ))}
</div>
```

- `icon?` + `iconVariant` — `tile` (default, the 36px bordered tile), `plain` (a
  bare 14px glyph), `custom` (you supply the whole tile, e.g. the brand-tinted
  `IntegrationTile`). Omit `icon` entirely for resources with no identity glyph
  (an API key, a permission group). `iconFilled` uses the skills/tools fill;
  `iconFill` lets an uploaded image reach the tile edge.
- `onClick` / `href` — makes the **whole row** activatable via a stretched
  overlay. Prefer `href` when the destination is a route, so the row keeps
  prefetch, middle-click, and open-in-new-tab. `clickLabel` is the accessible
  name and is **required** alongside either: the overlay has no text of its own.
- `navigable` — appends the one canonical chevron. Set it on rows that open a
  detail page; leave it off when `onClick` acts in place (revealing a folder).
  Never import an arrow yourself: `lucide-react` and `@sim/emcn/icons` ship
  visibly different glyphs, and the row already picked one.
- `trailing` vs `badge` — `trailing` is for **interactive** controls (a `Chip`, a
  `RowActionsMenu`) and sits above the hit area. `badge` is for **decoration** (a
  status tag) and is click-through. Putting a badge in `trailing` turns the row's
  right edge into a dead zone.
- `RESOURCE_LIST_STACK` / `RESOURCE_LIST_GRID` — the single-column and two-up
  containers. A `SettingsResourceRow` carries its own `-mx-2` bleed and padding,
  so a container holding one only sets rhythm: never add a second `-mx-2` (they
  stack into a 16px bleed) and never a different gap. A list of hand-rolled rows
  is the opposite — there the container owns the bleed. Note `-mx-2` inside a
  fixed-height `overflow-y-auto` box forces a horizontal scrollbar; drop the
  bleed there.

**Three-dots vs. chevron** is not a taste call:

- Opens a **detail page** → `navigable` + a whole-row click, and no `Delete` in
  the row (it lives in the detail header).
- **No detail page** → a `RowActionsMenu` in `trailing`, and no `navigable`
  chevron. The row may still take an `onClick` for an in-place action — a folder
  mount reveals itself in Finder and also carries a `...` menu — but a row must
  never offer both a chevron and a menu.

## Other shared settings primitives (do not re-roll these)

- **`SettingsSection`** (`…/components/settings-section`) — muted label, hairline
  divider, body. Also carries `headerAccessory` and `action` slots. Never
  re-derive the label/divider chrome; `sim-styling.md` owns those tokens.
- **`SettingsField`** (`…/components/settings-field`) — a read-only label/value
  pair in a detail body: muted caption over the value. Pair it with
  `SETTINGS_FIELD_VALUE_CLASSES` for the value text.
- **`SettingsEmptyState`** (`…/components/settings-empty-state`) — the canonical
  muted status message, for empty lists, "no results", loading gates, **and
  failed loads** (`tone='error'`). `variant='fill'` (default) centers in the
  available height; `variant='inline'` sits in flow. Never hand-roll
  `<div className='flex h-full items-center justify-center …'>` or
  `<div className='py-4 text-center …'>`.
- **`RowActionsMenu`** (`…/components/row-actions-menu`) — the trailing `...`
  actions menu for a list row. Pass `label` (aria-label) and
  `actions: RowAction[]` (`{ label, onSelect, destructive?, disabled? }`); the
  component renders the canonical flush `...` trigger + `DropdownMenuContent`.
  Conditional items become array spreads: `...(canManage ? [{…}] : [])`. Never
  hand-roll the `<DropdownMenu>` + `<MoreHorizontal>` trigger per page.
- **`RESOURCE_TILE_BASE`** + one of `RESOURCE_TILE_FILL` / `RESOURCE_TILE_PLAIN`
  (`…/components/resource-tile`) — the 36px tile chrome, for the rare tile
  outside a row (a detail heading). `ResourceTile` wraps the filled pairing.
- **`MemberAvatar`** (`@/components/permissions/member-avatar`) — the one avatar
  for any member row.

## Deleting a resource

Delete lives in the **detail header**, as
`{ text: 'Delete', variant: 'destructive', onSelect: … }` behind a
`ChipConfirmModal` — never `textTone: 'error'`, never a bare `Chip`, and never
unconfirmed. A list row does not carry Delete when the resource has a detail page.

## Save / Discard + unsaved-changes guard

Any settings surface with editable state uses **one** shared stack — never
hand-roll a Save button, a Discard button, a `beforeunload`, or an "Unsaved
changes" modal:

- **`saveDiscardActions(config)`** (`@/components/settings/save-discard-actions`)
  — returns the canonical **Discard + Save** `SettingsAction[]`. **Save is always
  rendered** (primary), disabled until there is something to save, so every
  editable surface announces its primary action in the same place and a create
  form is never a page with no visible way to commit it; **Discard appears only
  when dirty**. Spread it into a `SettingsPanel` `actions` array, beside any
  sibling actions (a detail view's Delete / Remove override). Config: `dirty`,
  `saving`, `onSave`, `onDiscard`, `saveDisabled?`, `saveTooltip?`, `creating?`,
  `saveLabel?`, `savingLabel?`. Create flows pass `creating` — the
  Create / Creating... labels come as a pair and can never drift apart.
  `saveLabel`/`savingLabel` are only for genuinely bespoke wording (SSO's
  `Update`); never hand-roll the pair to get a create label.
- **`<SaveDiscardChips {...config} />`** (same module) — the identical rule
  rendered as chips, for surfaces whose header takes a `ReactNode` instead of
  action data (`CredentialDetailLayout`: skills, secrets, connected credentials).
  Both stacks derive from the one function; never hand-roll a Save chip.

`CredentialDetailLayout` stays slot-driven for exactly two reasons: its back
control is a real `<ChipLink href>` (deep-linkable / middle-clickable, which
`SettingsBackAction`'s `onSelect` cannot express), and actions like
`SkillImportButton` own a hidden file input and their own pending state.
**Everything else in one of those headers should be `SettingsAction` data**
rendered through `<SettingsActionChips actions={…} />` from
`@/components/settings/settings-header` — that is the shared chip path, and it
is what keeps tone/icon/variant/tooltip handling from drifting between the two
shells. Reach for it before hand-rolling a `Chip`.
- **`useSettingsUnsavedGuard({ isDirty })`** (`…/settings/hooks/use-settings-unsaved-guard`)
  — syncs the page's local `isDirty` into the shared `useSettingsDirtyStore` (so
  the sidebar's **section-switch** confirm + the centralized `beforeunload` both
  apply for free) and returns `{ showUnsavedModal, setShowUnsavedModal, guardBack,
  confirmDiscard }` for a detail view's **in-view back** chip.
  - **Top-level pages** (whitelabeling, sso): call it **unassigned** —
    `useSettingsUnsavedGuard({ isDirty: hasChanges })` — they only need the
    store-sync; the sidebar/`beforeunload` do the rest.
  - **Detail sub-views** (data-retention, access-control group-detail): route the
    back chip through `onClick={() => guard.guardBack(closeFn)}` and render the
    shared `<UnsavedChangesModal open={guard.showUnsavedModal}
    onOpenChange={guard.setShowUnsavedModal} onDiscard={guard.confirmDiscard} />`
    (from `@/app/workspace/[workspaceId]/components/credential-detail`). The
    in-view header **Discard** chip (via `SaveDiscardActions onDiscard`) is a
    *reset to original* — distinct from the back-confirm's discard, which leaves.
- **`useSettingsBeforeUnload`** is mounted **once** in the settings shell
  (`settings/[section]/settings.tsx`) — never add a per-page `beforeunload`.
- **Dirty *computation* stays local** (shapes differ: field-compare vs
  normalize+stringify) — only how dirty is *consumed* is shared. Derive it (a
  `const`/`useMemo`), never store it in `useState`.
- **CRITICAL — rules of hooks:** call `useSettingsUnsavedGuard(...)`
  **unconditionally, before every early-return gate** (entitlement / loading /
  not-entitled `return <SettingsEmptyState>`). A hook placed after a gate is
  skipped on gated renders and crashes.
- The route-based credential detail keeps its own `useUnsavedChangesGuard` (it
  guards real `router.push` navigation + browser Back via a history sentinel);
  it already shares `UnsavedChangesModal`, so copy stays unified.

## Detail sub-views

A drill-down view reached from a list row (selected MCP server, workflow MCP
server, permission group, retention policy) renders through
`SettingsPanel` like a list page: pass `back={{ text, icon: ArrowLeft, onSelect }}`
for the left back chip, `title` (the entity name), and the header `actions`, then
render the body. Do NOT hand-roll a shell or header bar; a tab bar renders as the
first body child. Gate/early-return states (not-entitled, loading, upgrade
prompts) stay as-is.

The route-based credential detail (`settings/secrets/[credentialId]`) is the lone
exception — it lives outside `[section]` and keeps its own `CredentialDetailLayout`.

## Audit checklist

A settings page is design-system-clean when:

- [ ] Its main return is a `<SettingsPanel>` (or `<>…<SettingsPanel>…</>` with modal siblings) — no hand-rolled shell/header/scroll/column.
- [ ] It renders **no** hand-rolled `<h1>`/description title block — the title comes from nav metadata.
- [ ] Header chips are in `actions`; a standalone search is in the `search` prop.
- [ ] Its `NavigationItem` has an accurate, consistent-length `description`.
- [ ] Detail sub-views and entitlement/loading gates keep their own chrome (intentional).
- [ ] If it has editable state: Save/Discard go through `SaveDiscardActions`, dirty is wired via `useSettingsUnsavedGuard` (called before any early-return gate), and there is **no** hand-rolled Save button / `beforeunload` / "Unsaved changes" modal.
- [ ] No business logic, handlers, or conditional rendering changed by the migration.
- [ ] No literal `text-[Npx]` classes — named scale tokens only (see "Text-scale tokens" above).
- [ ] Every **resource** list row (a thing with an identity — a tool, a server, a key, a credential) is a `SettingsResourceRow` in a `RESOURCE_LIST_STACK`/`RESOURCE_LIST_GRID` — no wrapper `<button>`/`<Link>`, no hand-passed arrow, no re-derived title/subtitle spans. Rows with a genuinely different shape stay bespoke: multi-line bodies (inbox tasks), tabular columns (billing invoices, credit usage), and grids (secrets).
- [ ] Rows that open a detail page use `navigable` + `clickLabel`; flat records use `RowActionsMenu`. Not both.
- [ ] Decorative trailing content is in `badge`, not `trailing`.
- [ ] Labeled sections use `SettingsSection`; read-only fields use `SettingsField`; empty/loading/error use `SettingsEmptyState`.
- [ ] Delete is a `destructive` header action behind a `ChipConfirmModal`.
- [ ] `tsc`, `biome`, and the page's tests pass.
