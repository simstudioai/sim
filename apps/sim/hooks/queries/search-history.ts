import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  clearSearchHistoryContract,
  listSearchHistoryContract,
  type RecordSearchHistoryBody,
  recordSearchHistoryContract,
  removeSearchHistorySourceContract,
  type SearchHistoryResponse,
} from '@/lib/api/contracts/knowledge/search-history'
import {
  SEARCH_HISTORY_STALE_TIME,
  searchHistoryKeys,
} from '@/hooks/queries/utils/search-history-keys'

export function useSearchHistory(organizationId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: searchHistoryKeys.list(organizationId, userId),
    queryFn: ({ signal }) =>
      requestJson(listSearchHistoryContract, { params: { id: organizationId! }, signal }),
    enabled: Boolean(organizationId && userId),
    staleTime: SEARCH_HISTORY_STALE_TIME,
  })
}

export function useRecordSearchHistory(
  organizationId: string | undefined,
  userId: string | undefined
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: RecordSearchHistoryBody) =>
      requestJson(recordSearchHistoryContract, { params: { id: organizationId! }, body }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: searchHistoryKeys.list(organizationId, userId) }),
  })
}

export function useClearSearchHistory(organizationId: string, userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => requestJson(clearSearchHistoryContract, { params: { id: organizationId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: searchHistoryKeys.list(organizationId, userId) }),
  })
}

/** Takes the sources off the list at once and restores them if the server refuses. */
export function useRemoveSearchHistorySource(organizationId: string, userId: string | undefined) {
  const queryClient = useQueryClient()
  const queryKey = searchHistoryKeys.list(organizationId, userId)
  return useMutation({
    mutationFn: (urls: readonly string[]) =>
      Promise.all(
        urls.map((url) =>
          requestJson(removeSearchHistorySourceContract, {
            params: { id: organizationId },
            body: { url },
          })
        )
      ),
    onMutate: async (urls) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<SearchHistoryResponse>(queryKey)
      if (previous)
        queryClient.setQueryData<SearchHistoryResponse>(queryKey, {
          ...previous,
          sources: previous.sources.filter((source) => !urls.includes(source.url)),
        })
      return { previous }
    },
    onError: (_error, _urls, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}
