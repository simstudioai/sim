import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const organizationSearchParsers = {
  q: parseAsString.withDefault(''),
  mode: parseAsStringLiteral(['search', 'assistant']),
} as const

/** A query is a filter-like view change, not navigation: replace, and clear when empty. */
export const organizationSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
