import { parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { ADD_CONNECTOR_SEARCH_PARAM } from '@/lib/credentials/client-state'
import { createSortParams } from '@/lib/url-state'

/**
 * Co-located, typed URL query-param definitions for the knowledge base detail
 * page. The client (`KnowledgeBase`) consumes this typed param definition as the
 * single source of truth.
 *
 * `addConnector` is a deep-link that pre-opens the "add connector" modal. Its
 * presence (even as an empty string) opens the modal; its value seeds the
 * initial connector type. Mirrors the integrations `connect` deep-link pattern.
 */
export const addConnectorParam = {
  key: ADD_CONNECTOR_SEARCH_PARAM,
  parser: parseAsString,
} as const

/**
 * `page` is the 1-based document-list pagination index for this knowledge base.
 * Distinct from the single-document subview's `page` (a different route). The
 * default page (1) clears from the URL.
 */
export const pageParam = {
  key: 'page',
  parser: parseAsInteger.withDefault(1),
} as const

/** Pagination view-state: clean URLs, no back-stack churn. */
export const pageUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/** Document `enabled` filter buckets, matching the status filter dropdown. */
const ENABLED_FILTERS = ['all', 'enabled', 'disabled'] as const

/** Sortable document columns, matching the `Resource` sort menu / `DocumentSortField`. */
export const KB_SORT_COLUMNS = [
  'filename',
  'fileSize',
  'tokenCount',
  'chunkCount',
  'uploadedAt',
  'enabled',
] as const

/**
 * `sort` / `dir` follow the shared sort convention (see `useUrlSort`). The
 * default (most-recently-uploaded first) matches the document query's default
 * order, so a clean URL means the default sort.
 */
export const kbDocumentSortParams = createSortParams(KB_SORT_COLUMNS, {
  column: 'uploadedAt',
  direction: 'desc',
})

/**
 * Grouped filter/search URL state for the document list.
 *
 * - `q` is the document name search. The input is controlled directly by the
 *   instant nuqs value; only its URL write is debounced via
 *   `useDebouncedSearchSetter` — never written on every keystroke.
 * - `enabled` filters by processing/enabled status (`all` clears from the URL).
 *
 * `tagFilterEntries` is intentionally NOT represented here: it is an array of
 * rich filter-rule objects (slot, field type, operator, value, value-to per
 * row), too large/structured for the URL per the URL-state doctrine. It stays
 * in local `useState`.
 */
export const documentFiltersParsers = {
  q: parseAsString.withDefault(''),
  enabled: parseAsStringLiteral(ENABLED_FILTERS).withDefault('all'),
} as const

/** Filter/search/sort view-state: clean URLs, no back-stack churn. */
export const documentFiltersUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
