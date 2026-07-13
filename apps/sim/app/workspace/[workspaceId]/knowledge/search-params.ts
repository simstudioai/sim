import { parseAsArrayOf, parseAsString } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'

/** Sortable knowledge base columns, matching the `Resource.Options` sort menu. */
export const KNOWLEDGE_SORT_COLUMNS = [
  'name',
  'documents',
  'tokens',
  'connectors',
  'created',
  'owner',
  'updated',
] as const

/**
 * `sort` / `dir` follow the shared sort convention (see `useUrlSort`). The
 * default (most-recently-updated first) matches the list's default ordering,
 * so a clean URL means the default sort.
 */
export const knowledgeSortParams = createSortParams(KNOWLEDGE_SORT_COLUMNS, {
  column: 'updated',
  direction: 'desc',
})

/**
 * Co-located, typed URL query-param definitions for the Knowledge Base list.
 *
 * - `search` is the knowledge base name/description filter. The input is
 *   controlled directly by the instant nuqs value; only its URL write is
 *   debounced via `limitUrlUpdates` (`debounce`) on the setter — never written
 *   on every keystroke.
 * - `connector` filters by connector presence; `content` filters by document
 *   presence; `owner` filters by creator id. All are multi-select arrays.
 *
 * Selecting a knowledge base navigates to the `knowledge/[id]` route (via
 * `router`), so the active knowledge base is route state, not query state, and
 * is intentionally not represented here.
 */
export const knowledgeParsers = {
  search: parseAsString.withDefault(''),
  connector: parseAsArrayOf(parseAsString).withDefault([]),
  content: parseAsArrayOf(parseAsString).withDefault([]),
  owner: parseAsArrayOf(parseAsString).withDefault([]),
} as const

/** Filter/search/sort view-state: clean URLs, no back-stack churn. */
export const knowledgeUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
