import { parseAsInteger, parseAsString } from 'nuqs/server'
import { ADD_CONNECTOR_SEARCH_PARAM } from '@/lib/credentials/client-state'

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
