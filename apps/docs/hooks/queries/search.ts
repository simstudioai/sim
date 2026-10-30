'use client'

import { useQuery } from '@tanstack/react-query'
import { array, literal, object, string } from 'zod/mini'

const SEARCH_STALE_TIME = 60_000
const SEARCH_GC_TIME = 300_000
const searchKeys = {
  all: ['docs-search'] as const,
  query: (query: string) => [...searchKeys.all, query] as const,
}
const resultsSchema = array(
  object({
    id: string(),
    type: literal('page'),
    url: string(),
    content: string(),
    breadcrumbs: array(string()),
  })
)

/** Reads the public search contract and cancels obsolete queries with the observer. */
export function useDocsSearch(query: string) {
  return useQuery({
    queryKey: searchKeys.query(query),
    enabled: query.length > 0,
    staleTime: SEARCH_STALE_TIME,
    gcTime: SEARCH_GC_TIME,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`, { signal })
      if (!response.ok) throw new Error('Search is unavailable. Try again.')
      return resultsSchema.parse(await response.json())
    },
  })
}
