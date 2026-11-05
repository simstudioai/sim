import { truncateAtCodePoint } from '@sim/utils/string'
import { createParser, createSerializer, parseAsString } from 'nuqs/server'
import { SIM_LINK_SEARCH_MAX_LENGTH, SIM_LINK_SORTS } from '@/lib/sim-links/validation'
import { createSortParams } from '@/lib/url-state'

const boundedSearch = (value: string) => truncateAtCodePoint(value, SIM_LINK_SEARCH_MAX_LENGTH, '')

/**
 * `create` opens the new-link editor, prefilled with its value as the name. `search` filters by
 * name, destination, or description.
 */
export const simLinksParsers = {
  create: parseAsString,
  search: createParser({ parse: boundedSearch, serialize: boundedSearch }).withDefault(''),
} as const

export const serializeSimLinkView = createSerializer(simLinksParsers)

/** Shared `sort` + `dir` params for the Sim Links list. */
export const simLinksSortParams = createSortParams(SIM_LINK_SORTS, {
  column: 'name',
  direction: 'asc',
})

export const simLinksUrlKeys = { history: 'replace', clearOnDefault: true } as const
