import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  clearSearchHistoryContract,
  listSearchHistoryContract,
  type RecordSearchHistoryBody,
  recordSearchHistoryContract,
} from '@/lib/api/contracts/knowledge/search-history'
import { useSession } from '@/lib/auth/auth-client'

export const SEARCH_HISTORY_STALE_TIME = 30_000
export const searchHistoryKeys = {
  all: ['search-history'] as const,
  lists: () => [...searchHistoryKeys.all, 'list'] as const,
  list: (organizationId: string | undefined, userId: string | undefined) =>
    [...searchHistoryKeys.lists(), organizationId ?? '', userId ?? ''] as const,
}

export function useSearchHistory(organizationId: string | undefined) {
  const { data: session } = useSession()
  return useQuery({
    queryKey: searchHistoryKeys.list(organizationId, session?.user?.id),
    queryFn: ({ signal }) =>
      requestJson(listSearchHistoryContract, { params: { id: organizationId! }, signal }),
    enabled: Boolean(organizationId && session?.user?.id),
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
