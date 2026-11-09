'use client'

import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'

export const ADMIN_PAGE_SIZE = 20

const SEARCH_PARAMS = {
  q: parseAsString.withDefault(''),
  offset: parseAsInteger.withDefault(0),
} as const

/** The submitted user search and its page offset, in the URL under the legacy keys. */
export function useDirectorySearch() {
  return useQueryStates(SEARCH_PARAMS, { history: 'replace', clearOnDefault: true })
}
