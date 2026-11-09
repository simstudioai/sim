'use client'

import { useQueryStates } from 'nuqs'
import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

/** Selectable status filters for the inbox task list. */
export const INBOX_STATUS_FILTERS = [
  'all',
  'completed',
  'processing',
  'received',
  'failed',
  'rejected',
] as const

type InboxStatusFilter = (typeof INBOX_STATUS_FILTERS)[number]

const inboxTaskParsers = {
  status: parseAsStringLiteral(INBOX_STATUS_FILTERS).withDefault('all'),
  search: parseAsString.withDefault(''),
} as const

/**
 * The task list's status filter and search, as legacy's `status` and `search`: clean URLs with no
 * back-stack churn. The search value is instant; only its URL write is debounced.
 */
export function useInboxTaskFilters() {
  const [{ status, search }, setFilters] = useQueryStates(inboxTaskParsers, {
    history: 'replace',
    clearOnDefault: true,
  })
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )
  return {
    status,
    search,
    setStatus: (next: InboxStatusFilter) => void setFilters({ status: next }),
    setSearch,
  }
}
