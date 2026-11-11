import type { BreadcrumbItem } from '@sim/emcn/breadcrumbs'
import type { MenuAction } from '@sim/emcn/menu/action-menu'

/** A list's remembered sort and filters, as the preferences store hands them back. */
export interface ListPreference {
  sort: { column: string; direction: 'asc' | 'desc' }
  filters: Readonly<Record<string, readonly string[]>>
}

interface SearchValues {
  toString(): string
}

/**
 * The list's own URL opened at `folderId`. Opening a folder ends a search, since the search spanned
 * every folder, but keeps the filters and sort the reader chose.
 */
export function folderHref(pathname: string, search: SearchValues, folderId: string | null) {
  const query = new URLSearchParams(search.toString())
  query.delete('search')
  if (folderId) query.set('folderId', folderId)
  else query.delete('folderId')
  const rest = query.toString()
  return rest ? `${pathname}?${rest}` : pathname
}

/**
 * The breadcrumb trail of a foldered list: the list's root, then the open folder's ancestors, each
 * a link that also accepts dragged rows, ending at the open folder with its commands.
 */
export function folderTrail(options: {
  rootLabel: string
  chain: readonly { id: string; name: string }[]
  hrefFor: (folderId: string | null) => string
  /** Commands on the open folder: Rename, Delete, Copy ID, Pin. */
  currentActions?: readonly MenuAction[]
  drop?: (folderId: string | null) => BreadcrumbItem['drop']
}): BreadcrumbItem[] {
  const last = options.chain.at(-1)
  return [
    {
      id: 'root',
      label: options.rootLabel,
      href: options.hrefFor(null),
      drop: options.drop?.(null),
    },
    ...options.chain.map((folder) => ({
      id: folder.id,
      label: folder.name,
      href: options.hrefFor(folder.id),
      actions: folder === last ? options.currentActions : undefined,
      drop: options.drop?.(folder.id),
    })),
  ]
}

/**
 * The sort menu's rows: one per column, then the order. A new column starts newest or largest
 * first, as legacy's sort does; choosing the order flips the active column.
 */
export function sortActions(options: {
  columns: readonly { id: string; label: string }[]
  sort: string
  dir: 'asc' | 'desc'
  onSort: (column: string, direction: 'asc' | 'desc') => void
}): MenuAction[] {
  return [
    ...options.columns.map(
      (column, index): MenuAction => ({
        id: column.id,
        label: column.label,
        headingBefore: index === 0 ? 'Sort by' : undefined,
        checked: options.sort === column.id,
        onSelect: () =>
          options.onSort(column.id, options.sort === column.id ? options.dir : 'desc'),
      })
    ),
    {
      id: 'asc',
      label: 'Ascending',
      headingBefore: 'Order',
      separatorBefore: true,
      checked: options.dir === 'asc',
      onSelect: () => options.onSort(options.sort, 'asc'),
    },
    {
      id: 'desc',
      label: 'Descending',
      checked: options.dir === 'desc',
      onSelect: () => options.onSort(options.sort, 'desc'),
    },
  ]
}

/**
 * A multi-value filter's rows: each choice toggles in place, and the menu stays open so several
 * can be picked at once.
 */
export function filterActions(options: {
  choices: readonly { value: string; label: string }[]
  selected: readonly string[]
  onChange: (next: string[]) => void
}): MenuAction[] {
  return options.choices.map((choice) => ({
    id: choice.value,
    label: choice.label,
    checked: options.selected.includes(choice.value),
    onSelect: () =>
      options.onChange(
        options.selected.includes(choice.value)
          ? options.selected.filter((value) => value !== choice.value)
          : [...options.selected, choice.value]
      ),
  }))
}

/** A filter trigger's text: its "all" label, the one choice, or how many are picked. */
export function filterSummary(
  choices: readonly { value: string; label: string }[],
  selected: readonly string[],
  all: string,
  noun: string
) {
  if (selected.length === 0) return all
  if (selected.length === 1)
    return choices.find((choice) => choice.value === selected[0])?.label ?? all
  return `${selected.length} ${noun}`
}

/**
 * What a list of `noun` says when a search or filter matched nothing. Search spans every folder and
 * filters only the open one; saying so stops a reader going looking elsewhere for themselves.
 */
export function noResults(search: string, filtered: boolean, noun: string) {
  const term = search.trim()
  return {
    title: `No matching ${noun}`,
    description: term
      ? 'Searched every folder in this workspace.'
      : 'Filters apply to this folder only.',
    action: term && filtered ? 'Clear search and filters' : term ? 'Clear search' : 'Clear filters',
  }
}
