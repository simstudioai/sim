'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationSessionPolicyContract,
  type OrganizationSessionPolicy,
  revokeOrganizationSessionsContract,
  type UpdateOrganizationSessionPolicyBody,
  updateOrganizationSessionPolicyContract,
} from '@/lib/api/contracts/organization'
import {
  SESSION_POLICY_STALE_TIME,
  sessionPolicyKeys,
} from '@/hooks/queries/utils/session-policy-keys'

export type SessionPolicyResponse = OrganizationSessionPolicy

async function fetchSessionPolicy(
  orgId: string,
  signal?: AbortSignal
): Promise<SessionPolicyResponse> {
  const { data } = await requestJson(getOrganizationSessionPolicyContract, {
    params: { id: orgId },
    signal,
  })
  return data
}

export function useOrganizationSessionPolicy(orgId: string | undefined) {
  return useQuery({
    queryKey: sessionPolicyKeys.settings(orgId ?? ''),
    queryFn: ({ signal }) => fetchSessionPolicy(orgId as string, signal),
    enabled: Boolean(orgId),
    staleTime: SESSION_POLICY_STALE_TIME,
  })
}

interface UpdateSessionPolicyVariables {
  orgId: string
  settings: UpdateOrganizationSessionPolicyBody
}

export function useUpdateOrganizationSessionPolicy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, settings }: UpdateSessionPolicyVariables) =>
      requestJson(updateOrganizationSessionPolicyContract, {
        params: { id: orgId },
        body: settings,
      }),
    onSuccess: ({ data }, { orgId }) => {
      queryClient.setQueryData(sessionPolicyKeys.settings(orgId), data)
    },
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: sessionPolicyKeys.settings(orgId) })
    },
  })
}

export function useRevokeOrganizationSessions() {
  return useMutation({
    mutationFn: ({ orgId }: { orgId: string }) =>
      requestJson(revokeOrganizationSessionsContract, {
        params: { id: orgId },
      }),
  })
}
