'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationSsoPolicyContract,
  type OrganizationSsoPolicy,
  updateOrganizationSsoPolicyContract,
} from '@/lib/api/contracts/organization'
import { ssoKeys } from '@/ee/sso/hooks/sso'

export const SSO_POLICY_STALE_TIME = 60 * 1000

async function fetchSsoPolicy(
  organizationId: string,
  signal?: AbortSignal
): Promise<OrganizationSsoPolicy> {
  const response = await requestJson(getOrganizationSsoPolicyContract, {
    params: { id: organizationId },
    signal,
  })
  return response.data
}

/** Whether members of this organization must sign in through its identity provider. */
export function useOrganizationSsoPolicy(organizationId?: string) {
  return useQuery({
    queryKey: ssoKeys.policy(organizationId),
    queryFn: ({ signal }) => fetchSsoPolicy(organizationId as string, signal),
    enabled: Boolean(organizationId),
    staleTime: SSO_POLICY_STALE_TIME,
  })
}

interface UpdateSsoPolicyVariables {
  organizationId: string
  requireSso: boolean
}

export function useUpdateOrganizationSsoPolicy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ organizationId, requireSso }: UpdateSsoPolicyVariables) =>
      requestJson(updateOrganizationSsoPolicyContract, {
        params: { id: organizationId },
        body: { requireSso },
      }),
    /** Settled, not success: a rejected write usually means the provider state moved underneath. */
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({ queryKey: ssoKeys.policy(variables.organizationId) }),
  })
}
