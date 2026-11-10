---
description: Settings page layout and SettingsPanel design-system compliance
paths:
  - "apps/sim/app/(site)/{account,selfhost}/settings/**"
  - "apps/sim/components/resource-tile/**"
  - "apps/sim/components/settings/**"
  - "apps/sim/ee/access-requests/components/**"
---

# Settings Pages

These rules cover the settings outside the Platform: the account and self-hosted settings
(`app/(site)/account/settings/`, `app/(site)/selfhost/settings/`) and the `components/settings` and
`ee/access-requests/components` modules in this rule's paths. Platform Settings follow
`sim-platform-views.md`. Each layout mounts `StandaloneSettingsShell`
(`@/components/settings/standalone-settings-shell`), which owns page chrome via
`SettingsHeaderShell` — a fixed header bar (a left back chip + right-aligned
action chips), a scroll region, and a centered `max-w-[48rem]` content column led
by a **title + description from navigation metadata**. The chrome stays mounted
across section navigation. Its routed title and description are available before
the section body resolves. Each section renders through the **`SettingsPanel`**
registrar
(`@/components/settings/settings-panel`), which feeds
the shell its header data and renders only the section body. Sections supply
**data**, never chrome.

Do NOT hand-roll any of these in a settings page — they are owned by the layout
shell (fed through `SettingsPanel`):

- `<div className='flex h-full flex-col bg-[var(--bg)]'>` shell
- the header bar — compose `PAGE_HEADER_BAR` (`@/components/page-header-bar`); never rewrite its padding
- the scroll container (`min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]`)
- the content column (`mx-auto … max-w-[48rem] … gap-7`)
- a title block (`<h1 className='font-medium text-[var(--text-body)] text-lg'>` + `<p className='text-[var(--text-muted)] text-md'>`)
- the page-level search input

## Canonical page shape

```tsx
import { SettingsPanel } from '@/components/settings/settings-panel'

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

```tsx illustrative
return (
  <>
    <SettingsPanel actions={…}>{body}</SettingsPanel>
    <SomeModal … />
  </>
)
```

## `SettingsPanel` props

- `actions?: SettingsAction[]` — right-aligned header chips, **data only**:
  `{ id?, text, textTone?: 'error', icon?, variant?: 'primary'|'destructive', active?,
  onSelect, onPrefetch?, disabled?, tooltip? }`.
  The shell renders each as a `Chip` — never pass JSX, a `<div>`, or `className`
  (the locked contract: it's structurally impossible to vibe-code a padding
  change). Multiple/conditional actions are a plain array
  (`[...(canManage ? [{…}] : []), …]`). Labels are **sentence case** (`Add override`,
  not `Add Override`). A disabled action that needs to explain itself sets
  `tooltip` (the shell renders the hover tooltip, disabled chip included). An action
  that wants to warm a route on hover sets `onPrefetch`; the shell wires it. A label
  that flips while pending (`Delete` → `Deleting...`) sets a stable `id`, or the chip
  remounts mid-action. A Save/Discard pair is two actions: `{ id: 'discard', … }`
  and a `variant: 'primary'` Save.
- `back?: SettingsBackAction` (`{ text, icon?, onSelect }`) — left-aligned back
  chip for a **detail sub-view** (e.g. a selected MCP server, a permission group,
  a retention policy). Detail sub-views render through `SettingsPanel` like list
  pages — they do NOT hand-roll their own shell.
- `docsLink?: string` — renders the header's `Docs` `ChipLink`.
- `search?: { value; onChange: (value: string) => void; placeholder?; disabled? }` —
  renders the canonical search field directly below the title. Pass `setSearchTerm`
  straight to `onChange`. Use this for a standalone search; if search shares a row
  with other controls (sort, filters, a date picker), render that whole row in
  `children` instead and omit the prop.
- `title?` / `description?` — overrides for the nav-driven defaults. **Only** for a
  detail sub-view that needs a different heading; normal pages never pass these.
  A top-level page's header identity must remain stable while its data loads:
  never replace navigation metadata with client-fetched copy after first paint.
  Put data-dependent context in the page body instead.
- `scrollContainerRef?: React.Ref<HTMLDivElement>` — forwards a ref to the scroll
  region (e.g. programmatic scroll-to-bottom).

## Title + description live in navigation metadata

`apps/sim/components/settings/navigation.ts` is the single source of truth. Each
`SETTINGS_SECTION_REGISTRY` entry projects onto a plane through `planes.<plane>`, and that
projection's one-line description is `planes.<plane>.description`, falling back to
`unified.description`; `SettingsPanel` resolves it via `getSettingsSectionMeta(plane, section)` and the
`SettingsSectionProvider` that `standalone-settings-shell.tsx` wraps around the active section.

Adding a page is the `add-settings-page` skill's Mode A.

## Text-scale tokens (no literal pixel sizes)

Settings pages never use a literal `text-[Npx]` class — always a named token from
the scale in `sim-styling.md` ("Text Scale"). Find stragglers with
`rg 'text-\[1[0-8]px\]' apps/sim/components/settings apps/sim/ee`.

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
(`-mx-2 … rounded-lg p-2`), the hit area, the focus ring,
and — on activatable rows only — the hover band. Never hand-roll any of it, and never wrap the row in your own
`<button>` or `<Link>` — that is what `onClick` is for.

```tsx
<div className={RESOURCE_LIST_STACK}>
  {items.map((item) => (
    <SettingsResourceRow
      key={item.id}
      icon={<Wrench className='text-[var(--text-icon)]' />}
      title={item.name}
      description={item.summary}
      onClick={() => open(item.id)}
      clickLabel={`Open ${item.name}`}
    />
  ))}
</div>
```

- `icon?` + `iconVariant` — `tile` (default, the 36px bordered tile), `plain` (a
  bare 14px glyph), `custom` (you supply the whole tile, e.g. the brand-tinted
  `IntegrationTile`). Omit `icon` entirely for resources with no identity glyph
  (an API key, a permission group).
- `onClick` — makes the **whole row** activatable via a stretched
  overlay. Always pass `clickLabel` with
  it — the overlay holds no text, so it is the control's *only* accessible
  name. The prop is optional in the type (nothing enforces it), so omitting it
  ships a nameless button rather than failing the build.
- `trailing` vs `badge` — `trailing` is for **interactive** controls (a `Chip`, a
  `RowActionsMenu`) and sits above the hit area. `badge` is for **decoration** (a
  status tag) and is click-through. Putting a badge in `trailing` turns the row's
  right edge into a dead zone.
- `RESOURCE_LIST_STACK` — the list container. A `SettingsResourceRow` carries its own `-mx-2` bleed and padding,
  so a container holding one only sets rhythm: never add a second `-mx-2` (they
  stack into a 16px bleed) and never a different gap. A list of hand-rolled rows
  is the opposite — there the container owns the bleed. A row inside a
  fixed-height `overflow-y-auto` box, or a heading that must line up with the
  section labels under it, passes `flush` to drop the bleed and padding.

## Other shared settings primitives (do not re-roll these)

- **`SettingsSection`** (`…/components/settings-section/settings-section` — this
  directory has no barrel) — muted label, hairline
  divider, body. Also carries `headerAccessory` and `action` slots. Never
  re-derive the label/divider chrome; `sim-styling.md` owns those tokens.
- **`SettingsEmptyState`** (`…/components/settings-empty-state`) — the canonical
  muted status message for empty lists, "no results", loading gates, and failed
  reads. `variant='fill'` (default) centers in the available height;
  `variant='inline'` sits in flow. Never hand-roll its layout.
- **`SettingsQueryErrorState`** (same module) — the muted read-failure message
  with an accessible alert and retry control. Show an initial failure when data
  is unavailable; preserve cached content, mounted editors, and unsaved drafts
  during background failures, using an inline status. Validation and mutation
  failures retain their error styling.
- **`RowActionsMenu`** (`…/components/row-actions-menu`) — the trailing `...`
  actions menu for a list row. Pass `label` (aria-label) and
  `actions: RowAction[]` (`{ label, onSelect, destructive?, disabled? }`); the
  component renders the canonical flush `...` trigger + `DropdownMenuContent`.
  Conditional items become array spreads: `...(canManage ? [{…}] : [])`. Never
  hand-roll the `<DropdownMenu>` + `<MoreHorizontal>` trigger per page.
- **`RESOURCE_TILE_BASE`** + `RESOURCE_TILE_PLAIN`
  (`components/resource-tile` — note: *not* under
  `settings/`, unlike the other `…/` paths on this page) — the 36px tile chrome, for
  any tile the row does not draw itself: a detail heading, or a caller-supplied
  `iconVariant='custom'` tile. `RESOURCE_TILE_PLAIN` frames a brand logo or favicon.


**One member avatar.** Every member list, owner cell, and ranking renders emcn
`<Avatar size='xs' name={…} src={…} />` — a 14px photo, or the initial on the
neutral disc. Pass `aria-hidden` only when the member's name is visibly rendered
beside it; an email-only row (`MemberRow`) keeps the avatar labelled because it
carries the name. Never hand-roll an avatar or give a person a `getUserColor`
hash; per-person colors belong to live collaboration (presence, cursors), where
the color matches that person's cursor.

## Header action order

Every detail header reads left→right:

```
← Back        [secondary actions] → Delete → Discard → Save
```

You do not have to get the array order right — `orderHeaderActions()` ranks them
(secondary → `id:'delete'` → `id:'discard'` → `variant:'primary'`), order-stable
within each band, so listing Save first still renders it last. Two stacks apply
it: `SettingsHeaderShell` and `Resource.Header`, so tables, files, knowledge and
logs get the same ordering as settings.

Delete is placed by its **`id`**, not by position, which is why `id:'delete'` is
required rather than cosmetic: a page with no primary action still must not
leave a destructive chip in the slot a primary would occupy.

The bar geometry and the action cluster are both single-sourced in
`@/components/page-header-bar` — `PAGE_HEADER_BAR` (or `Resource.Header`'s
bordered variant) and `HEADER_ACTION_CLUSTER`. Never re-derive `h-[30px]`,
`gap-1`, or the lane padding per header.
`settings-header-shell.test.tsx` pins that a reordered chip still routes to its
own handler.

**The primary chip is always right-most**, and it is not always Save — on a
page with no save state it is whatever the primary action is (`Add workflows`,
`Import`). Delete still precedes it.

## Deleting a resource

Delete lives in the **detail header**, as `{ id: 'delete', text: 'Delete',
onSelect: … }` behind a `ChipConfirmModal` — a **plain chip**, never
`textTone: 'error'`, and never unconfirmed. In a `SettingsPanel` header it is
action *data*, never a hand-rolled `<Chip>`. Always set `id: 'delete'`; without a
stable id the chip remounts when the label flips to `Deleting...`.

`variant: 'destructive'` is reserved for actions that are destructive at
**scale** — `Delete all` passwords, `Clear all` browsing data, `Sign out all
members`. Removing the single resource you are already looking at is confirmed
by the modal, so it does not also need a red chip.

A list row does not carry Delete when the resource has a detail page.

## Save / Discard + unsaved-changes guard

Any settings surface with editable state uses **one** shared guard — never
hand-roll a `beforeunload` or an "Unsaved changes" modal. Save and Discard are
`SettingsAction` data in the panel's `actions`:

- **`useSettingsUnsavedGuard({ isDirty, navigationBlocked, onDiscard })`** from
  `@/hooks/use-settings-unsaved-guard` registers one editor with the
  shared settings store. Register every full-page draft, including inline creation
  forms. Dirty computation stays local and derived; fetched defaults stay clean.
- **`onDiscard` resets the registered draft.** The root `SettingsNavigationGuard`
  owns the discard dialog, internal link interception, browser Back/Forward, and
  refresh protection for registered editors. Do not add a per-page dialog or
  history listener for an editor using this hook.
- **Native history needs entry indexes.** The Navigation API supplies them for
  legacy entries. Without it, native traversal to an unindexed entry cannot be
  cancelled reliably; never guess a direction or rewrite the history stack.
- **History confirmation authorizes traversal before discarding.** Drafts are
  discarded only when the browser reports the confirmed traversal, so a no-op
  Back or Forward retains edits. Known cross-document traversal uses native unload
  protection. An unknown cross-document target on a classic History browser can
  require a second native confirmation after the shared dialog.
- **Detail back controls** call `guard.guardBack(closeFn)`. Other destructive view
  transitions, such as switching an editor's direction or environment, also use
  the shared `requestLeave` action before resetting their draft.
- **`navigationBlocked` covers pending saves and uploads.** The shared guard blocks
  navigation while requests are pending. Attempts are not queued; retry after they
  settle. Disable or preserve edits made during requests;
  failed saves retain drafts, and successful saves only clear committed values.
- **Call the hook unconditionally, before every early-return gate** (entitlement,
  loading, or empty-state return), so gated renders preserve hook order.

## Detail sub-views

A drill-down view reached from a list row (selected MCP server, workflow MCP
server, permission group, retention policy) renders through
`SettingsPanel` like a list page: pass `back={{ text, icon: ArrowLeft, onSelect }}`
for the left back chip, `title` (the entity name), and the header `actions`, then
render the body. Do NOT hand-roll a shell or header bar; a tab bar renders as the
first body child. Gate/early-return states (not-entitled, loading, upgrade
prompts) stay as-is.

## Audit checklist

A settings page is design-system-clean when:

- [ ] Its main return is a `<SettingsPanel>` (or `<>…<SettingsPanel>…</>` with modal siblings) — no hand-rolled shell/header/scroll/column.
- [ ] It renders **no** hand-rolled `<h1>`/description title block — the title comes from nav metadata.
- [ ] Header chips are in `actions`; a standalone search is in the `search` prop.
- [ ] Its registry entry has an accurate, consistent-length `description`.
- [ ] Detail sub-views and entitlement/loading gates keep their own chrome (intentional).
- [ ] If it has editable state: Save/Discard are header actions (`id: 'discard'`, a primary Save), dirty is wired via `useSettingsUnsavedGuard` (called before any early-return gate), and there is **no** hand-rolled Save button / `beforeunload` / "Unsaved changes" modal.
- [ ] No business logic, handlers, or conditional rendering changed by the migration — except where the shared primitive makes a gate structural (a permission gate becomes `onClick={can ? … : undefined}`, which renders a plain non-interactive row).
- [ ] No literal `text-[Npx]` classes — named scale tokens only (see "Text-scale tokens" above).
- [ ] Every **resource** list row (a thing with an identity — a tool, a server, a key, a credential) is a `SettingsResourceRow` in a `RESOURCE_LIST_STACK` — no wrapper `<button>`/`<Link>`, no hand-passed arrow, no re-derived title/subtitle spans. Rows with a genuinely different shape stay bespoke: multi-line bodies (inbox tasks), tabular columns (billing invoices, credit usage), grids (secrets), and the member rows (see the avatar note above).
- [ ] Rows that open a detail page use `onClick` + `clickLabel`; flat records use `RowActionsMenu`.
- [ ] Decorative trailing content is in `badge`, not `trailing`.
- [ ] Labeled sections use `SettingsSection`; empty/loading/read-failure messages use `SettingsEmptyState`, with `SettingsQueryErrorState` when offering retry.
- [ ] Delete is a plain `id:'delete'` header action behind a `ChipConfirmModal`; `destructive` is reserved for bulk actions.
- [ ] The local gate in the root `CLAUDE.md` ("How your work is checked") passes.
