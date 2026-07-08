import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type UnsubscribeActionResponse,
  type UnsubscribeData,
  type UnsubscribeType,
  unsubscribeGetContract,
  unsubscribePostContract,
} from '@/lib/api/contracts/user'

export const UNSUBSCRIBE_DETAIL_STALE_TIME = 5 * 60 * 1000

export const unsubscribeKeys = {
  all: ['unsubscribe'] as const,
  details: () => [...unsubscribeKeys.all, 'detail'] as const,
  detail: (email?: string, token?: string) =>
    [...unsubscribeKeys.details(), email ?? '', token ?? ''] as const,
}

async function fetchUnsubscribe(
  email: string,
  token: string,
  signal?: AbortSignal
): Promise<UnsubscribeData> {
  return requestJson(unsubscribeGetContract, { query: { email, token }, signal })
}

/**
 * Validates an unsubscribe link and loads the recipient's current email preferences.
 * Auto-runs on mount once both `email` and `token` are present.
 */
export function useUnsubscribe(email?: string, token?: string) {
  return useQuery({
    queryKey: unsubscribeKeys.detail(email, token),
    queryFn: ({ signal }) => fetchUnsubscribe(email as string, token as string, signal),
    enabled: Boolean(email) && Boolean(token),
    staleTime: UNSUBSCRIBE_DETAIL_STALE_TIME,
    retry: false,
  })
}

interface UnsubscribeVariables {
  email: string
  token: string
  type: UnsubscribeType
}

/**
 * Submits an unsubscribe action and reconciles the cached preferences so the
 * affected option immediately reflects the unsubscribed state.
 */
export function useUnsubscribeMutation() {
  const queryClient = useQueryClient()
  return useMutation<UnsubscribeActionResponse, Error, UnsubscribeVariables>({
    mutationFn: ({ email, token, type }) =>
      requestJson(unsubscribePostContract, { body: { email, token, type } }),
    onSuccess: (_data, { email, token, type }) => {
      const key = unsubscribeKeys.detail(email, token)
      queryClient.setQueryData<UnsubscribeData>(key, (previous) => {
        if (!previous) return previous
        const preferenceKey =
          type === 'all'
            ? 'unsubscribeAll'
            : (`unsubscribe${type.charAt(0).toUpperCase()}${type.slice(1)}` as
                | 'unsubscribeMarketing'
                | 'unsubscribeUpdates'
                | 'unsubscribeNotifications')
        return {
          ...previous,
          currentPreferences: {
            ...previous.currentPreferences,
            [preferenceKey]: true,
          },
        }
      })
    },
  })
}
