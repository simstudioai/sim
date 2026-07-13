import { parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'

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

export type KnowledgeSortColumn = (typeof KNOWLEDGE_SORT_COLUMNS)[number]

const SORT_DIRECTIONS = ['asc', 'desc'] as const

/** Default sort: most-recently-updated first. */
export const DEFAULT_KNOWLEDGE_SORT_COLUMN: KnowledgeSortColumn = 'updated'
export const DEFAULT_KNOWLEDGE_SORT_DIRECTION = 'desc'

/**
 * Co-located, typed URL query-param definitions for the Knowledge Base list.
 *
 * - `search` is the knowledge base name/description filter. The input is
 *   controlled directly by the instant nuqs value; only its URL write is
 *   debounced via `limitUrlUpdates` (`debounce`) on the setter — never written
 *   on every keystroke.
 * - `sort` / `dir` follow the shared sort convention (two scalar params). "No
 *   active sort" is derived in the component as `sort === DEFAULT && dir ===
 *   DEFAULT`.
 * - `connector` filters by connector presence; `content` filters by document
 *   presence; `owner` filters by creator id. All are multi-select arrays.
 *
 * Selecting a knowledge base navigates to the `knowledge/[id]` route (via
 * `router`), so the active knowledge base is route state, not query state, and
 * is intentionally not represented here.
 */
export const knowledgeParsers = {
  search: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(KNOWLEDGE_SORT_COLUMNS).withDefault(DEFAULT_KNOWLEDGE_SORT_COLUMN),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault(DEFAULT_KNOWLEDGE_SORT_DIRECTION),
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
