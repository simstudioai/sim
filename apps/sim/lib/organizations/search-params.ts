import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'

export const organizationSearchParsers = {
  q: parseAsString.withDefault(''),
  mode: parseAsStringLiteral(['search', 'assistant']),
} as const

/** A query is a filter-like view change, not navigation: replace, and clear when empty. */
export const organizationSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

export interface OrganizationSummaryRequest {
  id: string
  message: string
  assistantSearch: WorkspaceSearchFilters
}
