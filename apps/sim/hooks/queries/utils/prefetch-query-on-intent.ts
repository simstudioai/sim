import type { FetchQueryOptions, QueryClient, QueryKey } from '@tanstack/react-query'

type QueryFilterKey = NonNullable<
  NonNullable<Parameters<QueryClient['removeQueries']>[0]>['queryKey']
>

/**
 * Starts a speculative query without allowing an inactive failure to poison a later mount.
 * Mounted observers retain the error so their component can render truthful feedback.
 */
export function prefetchQueryOnIntent<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>
): void {
  void queryClient.prefetchQuery(options).then(() => {
    if (queryClient.getQueryState(options.queryKey)?.status !== 'error') return

    queryClient.removeQueries({
      queryKey: options.queryKey as QueryFilterKey,
      exact: true,
      type: 'inactive',
    })
  })
}
