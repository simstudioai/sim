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
