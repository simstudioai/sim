'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { useClearSearchHistory, useSearchHistory } from '@/hooks/queries/search-history'

const HISTORY_RECENT_LIMIT = 5

/** The viewer's private recent activity, and which list is showing. A failed read hides stale rows. */
export function useSearchLandingHistory(organizationId: string, userId: string) {
  const history = useSearchHistory(organizationId, userId)
  const clearHistory = useClearSearchHistory(organizationId, userId)
  const [selection, setSelection] = useState<'sources' | 'queries' | null>(null)
  const data = history.isError ? undefined : history.data
  const sources = data?.sources.slice(0, HISTORY_RECENT_LIMIT) ?? []
  const queries = data?.queries.slice(0, HISTORY_RECENT_LIMIT) ?? []
  return {
    failed: history.isError,
    retrying: history.isFetching,
    retry: () => void history.refetch(),
    sources,
    queries,
    selected: selection ?? (sources.length > 0 ? 'sources' : 'queries'),
    setSelection,
    isClearing: clearHistory.isPending,
    clear: () => clearHistory.mutate(undefined, { onError: (error) => toast.error(error.message) }),
  }
}
