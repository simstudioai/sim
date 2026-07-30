import { parseAsStringLiteral, type SingleParserBuilder } from 'nuqs/server'

/** The two sort directions every sortable list shares. */
export const SORT_DIRECTIONS = ['asc', 'desc'] as const

export type SortDirection = (typeof SORT_DIRECTIONS)[number]

/** The list's default ordering — what a clean URL means. */
export interface SortDefault<C extends string> {
  column: C
  direction: SortDirection
}

type DefaultedParser<T extends string> = ReturnType<SingleParserBuilder<T>['withDefault']>

/**
 * Sort params whose defaults match the list's server/default ordering. A clean
 * URL means the default sort; explicitly selecting the default collapses back
 * to a clean URL (`clearOnDefault`), so "no active sort" and "default sort"
 * are the same state.
 */
export interface DefaultedSortParams<C extends string> {
  columns: readonly C[]
  default: SortDefault<C>
  parsers: { sort: DefaultedParser<C>; dir: DefaultedParser<SortDirection> }
}

/**
 * Nullable sort params for lists where "no active sort" is behaviorally
 * distinct from explicitly sorting by the fallback column (e.g. files: with no
 * sort, files order by updated/desc but folders by name/asc). The params carry
 * no defaults, so an explicit selection always persists in the URL and
 * clearing writes `null` to strip both.
 */
export interface NullableSortParams<C extends string> {
  columns: readonly C[]
  default: null
  parsers: { sort: SingleParserBuilder<C>; dir: SingleParserBuilder<SortDirection> }
}

/**
 * Builds the canonical `sort` + `dir` URL param pair for a sortable list (see
 * `.claude/rules/sim-url-state.md`, "Sort convention"). Pass `defaultSort`
 * when the list has a fixed default ordering (the common case); omit it for
 * the nullable mode where "no active sort" is a distinct state. Consume with
 * `useUrlSort` from `@/hooks/use-url-sort`.
 */
export function createSortParams<const C extends string>(
  columns: readonly C[],
  defaultSort: SortDefault<NoInfer<C>>
): DefaultedSortParams<C>
export function createSortParams<const C extends string>(
  columns: readonly C[]
): NullableSortParams<C>
export function createSortParams<const C extends string>(
  columns: readonly C[],
  defaultSort?: SortDefault<NoInfer<C>>
): DefaultedSortParams<C> | NullableSortParams<C> {
  const sort = parseAsStringLiteral(columns)
  const dir = parseAsStringLiteral(SORT_DIRECTIONS)
  if (defaultSort) {
    return {
      columns,
      default: defaultSort,
      parsers: {
        sort: sort.withDefault(defaultSort.column),
        dir: dir.withDefault(defaultSort.direction),
      },
    }
  }
  return { columns, default: null, parsers: { sort, dir } }
}
