import { parseAsStringLiteral } from 'nuqs/server'
import type { AssistantSearchLevel } from '@/lib/mothership/generated/assistant'
import { organizationSearchParsers } from '@/app/o/[organizationId]/search/search-params'
import { searchFilterParsers } from '@/app/workspace/[workspaceId]/home/search-params'

export type SearchLevel = AssistantSearchLevel

/** Keep stored/URL choices compatible while live Search presents just Auto and Max. */
export function resolveSearchLevel(
  value: SearchLevel | null | undefined,
  liveSearch: boolean
): SearchLevel {
  return liveSearch ? (value === 'max' ? 'max' : 'fast') : (value ?? 'adaptive')
}
export const SEARCH_LEVEL_VALUES = [
  'fast',
  'adaptive',
  'max',
] as const satisfies readonly SearchLevel[]

export const organizationHomeParsers = {
  ...organizationSearchParsers,
  ...searchFilterParsers,
  searchLevel: parseAsStringLiteral(SEARCH_LEVEL_VALUES),
} as const
