---
paths:
  - "apps/sim/app/**/*.tsx"
  - "apps/sim/ee/**/*.tsx"
  - "apps/sim/components/**/*.tsx"
---

# List & Menu Ordering

**A list orders itself the way the user already reads the same things somewhere else.** Dropdowns, context menus, tab strips, command palettes, and settings navs are all *second* presentations of a set the user has already seen — in the sidebar, in a toolbar, in a column-header row. When the second presentation reorders that set, the user re-reads it from scratch every time.

This is not a style preference. Order is the cheapest affordance a list has, and the only one that costs nothing to get right.

## The rule

Before writing a list of items, find where the user sees those same items *first*. That surface owns the order; your list mirrors it.

| The list | Mirrors |
| --- | --- |
| Resource menus (`+` attach, `@` mention, resource-tab `+`) | the workspace **sidebar**, top-down |
| A row / root **context menu** | that surface's **toolbar**, left-to-right → top-to-bottom |
| Settings tab strip, recently-deleted tabs | the **settings nav**, top-down |
| A "New …" menu | the order those things appear once created |

Left-to-right becomes top-to-bottom. A toolbar reading `Filter · Sort · Export · Delete` becomes a menu reading Filter, Sort, Export, Delete — never alphabetized, never grouped by implementation, never "destructive last" unless the toolbar already puts it last.

Platform-only entries (desktop **Browser** and **Terminal**) trail the shared set rather than interleaving, so the common prefix is identical on every platform.

## Grouping: a rule marks a change in what the action acts on

Order is governed above. **Separators are governed here.**

A `DropdownMenuSeparator` earns its place when the next group stops acting on the thing the user
clicked. That is the whole test — one question, asked the same way in every menu:

| The group | Gets a rule before it |
| --- | --- |
| Acts on the clicked item (open, rename, duplicate, export, copy, edit, pin, run) | no — this is the body of the menu |
| Acts on **something else** — the page's filters or view, or a newly created sibling | yes |
| **Destroys or detaches** it (delete, leave, close, hide, remove) | yes |

Most row menus only ever have the one transition, so they carry one rule, immediately before
`Delete`. A menu that also filters the page or inserts siblings carries two. Nothing carries
more, because there is no third thing a menu acts on.

Do **not** band by verb. "Navigation", "status", "edit", "copy" are categories of *what the verb
is*, not of *what it touches*, and the user meets no such taxonomy anywhere else — every toolbar
in the app is a flat `gap-1` chip row with no dividers. Menus banded that way put the same action
in different groups depending on which siblings happened to be visible.

The consequential group trails in almost every menu. It leads in exactly one: the **logs row
menu**, where `Retry` and `Cancel Run` act on the run itself and are the primary actions on a
failure, so they sit on top with the rule beneath them. Ordering follows the surface (see "The
rule" above); the separator fences whichever end that group occupies.

A group whose items are merely *disabled* still gets no extra rule — `disabled` is not a group.

```tsx
// ✗ Bad — four semantic bands the user meets nowhere else
Open in new tab │─── Rename, Lock │─── Duplicate, Export │─── Delete

// ✓ Good — one rule, where the menu stops acting on the workflow
Open in new tab, Rename, Lock, Duplicate, Export │─── Delete
```

**Worked examples.** The logs row menu carries two: `Retry, Cancel Run │ Copy Run ID, Copy Link,
Open Workflow, Open Snapshot │ Filter by Workflow, Clear Filters` — the run, then this log, then
the page. The table row and column menus carry two: the rule before `Insert row above` /
`Insert column left` is where the menu stops acting on the clicked cell and starts creating
siblings. Every other row menu in the app has only the destructive transition, so it carries one.

**The one standing exception: menus that emulate a native menu.** The text-editor menu
(`editor-context-menu.tsx`), the terminal menu (`terminal-context-menu.tsx`), and the browser
page menu (`browser-session.tsx`) each mirror the OS menu the user already knows — clipboard
banding (`Cut · Copy · Paste │ Select all`) is a convention every text field on their machine
teaches them. These keep their native banding, and that is the *same* principle as the ordering
rule above: mirror the surface the user already reads. The test is whether a real menu outside
Sim taught them the grouping. Our own resource, row, and action menus have no such precedent —
the toolbars they mirror are flat — so they take the single rule.

**Both sides of every rule must be guaranteed non-empty.** Write the separator's guard out of
the *exact* render conditions of the items around it, never a looser approximation:

```tsx
// ✗ Bad — `showLeave` alone, while the Leave item needs `showLeave && onLeave`.
//         A caller passing showLeave from a permission check with a conditional
//         onLeave renders a trailing rule under the last item.
{hasActionsAbove && (showLeave || showDelete) && <DropdownMenuSeparator />}

// ✓ Good — each term is the item's own condition, verbatim
const hasDestructiveSection = (showLeave && onLeave) || showDelete
{hasActionsAboveDestructive && hasDestructiveSection && <DropdownMenuSeparator />}
```

This is the failure that put a dangling rule at the bottom of the logs row menu, where two
unconditional separators sat above conditional items.

**Do not add a prop to move a rule.** The shared workflow context menu grew
`groupNonDestructiveActions` and `separateNavigationAction` for this; between them they moved one
separator for one caller, four of six branches were unreachable, and `separateNavigationAction`
had no observable effect anywhere in the repo. Both are gone. A menu that wants different
grouping wants the standard grouping.

## Encode the order once

An order duplicated across surfaces is an order that will drift. Export **one** constant and sort by it — do not hand-maintain a matching literal per menu.

```ts
/** Top-down order for every menu listing resource families, mirroring the sidebar. */
export const RESOURCE_MENU_ORDER: readonly MothershipResourceType[] = [
  'integration', 'task', 'table', 'file', 'filefolder',
  'knowledgebase', 'log', 'workflow', 'folder', 'browser', 'terminal', 'generic',
]

export function byResourceMenuOrder<T extends { type: MothershipResourceType }>(a: T, b: T) {
  return RESOURCE_MENU_ORDER.indexOf(a.type) - RESOURCE_MENU_ORDER.indexOf(b.type)
}
```

Canonical instance: `app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry/resource-registry.tsx`, consumed by `useAvailableResources` and `ResourceMenuSections`.

## Render kinds in one pass, not one phase per kind

The most common way a canonical order gets silently defeated: emitting all items of one *kind* and then all of another. Every submenu-backed family lands above every flat family regardless of what the order constant says.

```tsx
// ✗ Bad — two phases; the trees always pin to the top
<ResourceTreeSections sections={treeSections} />
{groups.filter((g) => !FOLDERED.has(g.type)).map(renderFlat)}

// ✓ Good — one ordered pass; each entry picks its own rendering
{entries.sort(byResourceMenuOrder).map((entry) =>
  sectionByType.has(entry.type) ? renderTree(entry) : renderFlat(entry)
)}
```

The same trap appears as "render the pinned ones, then the rest", "render enabled, then disabled", and "render the groups, then the loose items".

## When order may diverge

Only for reasons the user can perceive:

- **Search/filter results** rank by match quality — the whole point is that ranking beats position.
- **User-controlled ordering** (drag-to-reorder, manual `sortOrder`) wins over any canonical order.
- **Recency lists** ("Recent chats") order by time, which *is* the order the user reads them elsewhere.

"Grouped by which hook provides it", "alphabetical because it was easy", and "that's the order the array was built in" are not reasons.

## Reviewing

When a diff adds or edits a list of items, ask: where does the user see this set already, and does this match? If the answer is a different file with a different order, the diff needs a shared constant, not a second literal.
