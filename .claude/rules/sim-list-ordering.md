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
