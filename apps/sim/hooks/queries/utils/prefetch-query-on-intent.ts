import type { FetchQueryOptions, QueryClient, QueryKey } from '@tanstack/react-query'

type QueryFilterKey = NonNullable<
  NonNullable<Parameters<QueryClient['removeQueries']>[0]>['queryKey']
>

/** Removes a speculative read that failed and that nothing is mounted to report. */
function dropFailedSpeculativeQuery(queryClient: QueryClient, queryKey: QueryKey): void {
  const state = queryClient.getQueryState(queryKey)
  if (state?.status !== 'error' || state.data !== undefined) return

  queryClient.removeQueries({
    queryKey: queryKey as QueryFilterKey,
    exact: true,
    type: 'inactive',
  })
}

/**
 * Starts a speculative query without allowing an inactive failure to poison a later mount.
 * Mounted observers retain the error so their component can render truthful feedback.
 */
export function prefetchQueryOnIntent<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>
): void {
  void queryClient
    .prefetchQuery(options)
    .then(() => dropFailedSpeculativeQuery(queryClient, options.queryKey))
}
