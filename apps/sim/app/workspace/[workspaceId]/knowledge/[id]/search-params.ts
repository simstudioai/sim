import { parseAsString } from 'nuqs/server'
import { ADD_CONNECTOR_SEARCH_PARAM } from '@/lib/credentials/client-state'

/**
 * Co-located, typed URL query-param definition for the knowledge base detail
 * page. Both the client (`KnowledgeBase`) and any server component that reads
 * this param consume this single source of truth.
 *
 * `addConnector` is a deep-link that pre-opens the "add connector" modal. Its
 * presence (even as an empty string) opens the modal; its value seeds the
 * initial connector type. Mirrors the integrations `connect` deep-link pattern.
 */
export const addConnectorParam = {
  key: ADD_CONNECTOR_SEARCH_PARAM,
  parser: parseAsString,
} as const
