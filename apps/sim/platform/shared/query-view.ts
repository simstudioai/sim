import { isApiClientError } from '@/lib/api/client/errors'

const REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 409])

/**
 * The server's answer to this viewer's request, which retrying cannot change: a malformed link
 * (400), no access (401, 403, 404), or a surface that is off for them (409). A rate limit, a timeout
 * or a server failure is not one, and a view keeps what it has through those and offers a retry.
 */
export function isRefusal(error: unknown): boolean {
  return isApiClientError(error) && REFUSAL_STATUSES.has(error.status)
}

interface ReadableQuery {
  data: unknown
  status: 'pending' | 'error' | 'success'
  isLoadingError: boolean
  refetch: () => unknown
}

/** A read as a view takes it. Failure stays failure over placeholder rows, and a failed refresh keeps its data. */
export function queryView(query: ReadableQuery) {
  return {
    status: query.isLoadingError
      ? ('error' as const)
      : query.data !== undefined
        ? ('success' as const)
        : query.status,
    retry: () => void query.refetch(),
  }
}

interface PagedQuery {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  isPlaceholderData: boolean
  fetchNextPage: () => unknown
}

/** Placeholder rows belong to the previous search, so their next page is not this list's. */
export function loadMoreOf(query: PagedQuery, failureMessage: string) {
  return {
    hasMore: query.hasNextPage && !query.isPlaceholderData,
    loading: query.isFetchingNextPage,
    error: query.isFetchNextPageError ? failureMessage : undefined,
    onLoadMore: () => void query.fetchNextPage(),
  }
}
