import { createSerializer, parseAsString } from 'nuqs/server'
import { SIM_LINK_SORTS } from '@/lib/sim-links/validation'
import { createSortParams } from '@/lib/url-state'

/** `create` opens the new-link editor, prefilled with its value as the name. */
const simLinkViewParsers = { create: parseAsString } as const

export const serializeSimLinkView = createSerializer(simLinkViewParsers)

/** `search` filters by name, destination, or description; only its URL write is debounced. */
export const simLinksParsers = {
  ...simLinkViewParsers,
  search: parseAsString.withDefault(''),
} as const

/** Shared `sort` + `dir` params for the Sim Links list. Default: alphabetical. */
export const simLinksSortParams = createSortParams(SIM_LINK_SORTS, {
  column: 'name',
  direction: 'asc',
})

export const simLinksUrlKeys = { history: 'replace', clearOnDefault: true } as const
