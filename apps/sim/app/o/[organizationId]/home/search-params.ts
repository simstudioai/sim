import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { searchFilterParsers } from '@/app/workspace/[workspaceId]/home/search-params'

export const organizationHomeParsers = {
  mode: parseAsStringLiteral(['assistant', 'search'] as const).withDefault('assistant'),
  q: parseAsString.withDefault(''),
  ...searchFilterParsers,
} as const
