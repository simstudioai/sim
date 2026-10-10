import { parseAsString } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'

/** Sortable columns, matching the `Resource.Options` sort menu. */
const TEST_SORT_COLUMNS = ['name', 'cases', 'lastRun', 'updated'] as const

/** Shared `sort` + `dir` params for the Tests list. Default: most recently updated first. */
export const testsSortParams = createSortParams(TEST_SORT_COLUMNS, {
  column: 'updated',
  direction: 'desc',
})

/** `search` filters by title; the input is controlled by it and only its URL write is debounced. */
export const testsParsers = {
  search: parseAsString.withDefault(''),
} as const

export const testsUrlKeys = { history: 'replace', clearOnDefault: true } as const
