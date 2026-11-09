import { parseAsString } from 'nuqs'
import { createSortParams } from '@/lib/url-state'

/** The list's sortable columns, as legacy's sort menu offers them. Default: most recently updated. */
export const testsSortParams = createSortParams(['name', 'cases', 'lastRun', 'updated'] as const, {
  column: 'updated',
  direction: 'desc',
})

/** `search` filters by title or name; only its URL write is debounced. */
export const testsParsers = {
  search: parseAsString.withDefault(''),
} as const

export const testsUrlKeys = { history: 'replace', clearOnDefault: true } as const

/** The earlier run a test's results show; absent shows the latest. Shareable, so it is in the URL. */
export const testDetailParsers = {
  run: parseAsString,
} as const
