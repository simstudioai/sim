import { useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AccountDeletionPlan,
  type DeleteAccountBody,
  deleteAccountContract,
  getAccountDeletionPlanContract,
} from '@/lib/api/contracts/user'

export const accountDeletionKeys = {
  all: ['account-deletion'] as const,
  plan: () => [...accountDeletionKeys.all, 'plan'] as const,
}

/**
 * Zero: the plan is a consent disclosure, so every dialog open must refetch — its
 * blockers must reflect the account as it is right now, and a workspace that
 * gained an admin a minute ago changes the answer.
 *
 * The dialog stays mounted while closed, so the previous open's plan is still in
 * the cache and `isLoading` is false during that refetch. The dialog therefore
 * holds its confirm on `isFetching`, not `isLoading`, until fresh data lands;
 * `gcTime: 0` only evicts once the settings panel itself unmounts.
 */
export const ACCOUNT_DELETION_PLAN_STALE_TIME = 0

async function fetchAccountDeletionPlan(signal?: AbortSignal): Promise<AccountDeletionPlan> {
  const data = await requestJson(getAccountDeletionPlanContract, { signal })
  return data.plan
}

export function useAccountDeletionPlan(enabled: boolean) {
  return useQuery({
    queryKey: accountDeletionKeys.plan(),
    queryFn: ({ signal }) => fetchAccountDeletionPlan(signal),
    enabled,
    staleTime: ACCOUNT_DELETION_PLAN_STALE_TIME,
    gcTime: 0,
    retry: false,
  })
}

/**
 * Succeeds exactly once per account: the session that authorized it is gone by
 * the time the response lands, so there is no cache left to invalidate. The
 * caller is responsible for clearing local state and sending the user to sign-in.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (body: DeleteAccountBody) => {
      await requestJson(deleteAccountContract, { body })
    },
  })
}
