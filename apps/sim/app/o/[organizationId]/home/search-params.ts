import { parseAsStringLiteral } from 'nuqs/server'
import type { AssistantSearchLevel } from '@/lib/mothership/generated/assistant'
import { organizationSearchParsers } from '@/app/o/[organizationId]/search/search-params'
import { searchFilterParsers } from '@/app/workspace/[workspaceId]/home/search-params'

export type SearchLevel = AssistantSearchLevel

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
