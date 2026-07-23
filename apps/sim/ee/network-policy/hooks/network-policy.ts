'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationNetworkPolicyContract,
  type OrganizationNetworkPolicy,
  type UpdateOrganizationNetworkPolicyBody,
  updateOrganizationNetworkPolicyContract,
} from '@/lib/api/contracts/organization'

export type NetworkPolicyResponse = OrganizationNetworkPolicy

export const NETWORK_POLICY_STALE_TIME = 60 * 1000

export const networkPolicyKeys = {
  all: ['networkPolicy'] as const,
  settings: (orgId: string) => [...networkPolicyKeys.all, 'settings', orgId] as const,
}

async function fetchNetworkPolicy(
  orgId: string,
  signal?: AbortSignal
): Promise<NetworkPolicyResponse> {
  const { data } = await requestJson(getOrganizationNetworkPolicyContract, {
    params: { id: orgId },
    signal,
  })
  return data
}

export function useOrganizationNetworkPolicy(orgId: string | undefined) {
  return useQuery({
    queryKey: networkPolicyKeys.settings(orgId ?? ''),
    queryFn: ({ signal }) => fetchNetworkPolicy(orgId as string, signal),
    enabled: Boolean(orgId),
    staleTime: NETWORK_POLICY_STALE_TIME,
  })
}

interface UpdateNetworkPolicyVariables {
  orgId: string
  settings: UpdateOrganizationNetworkPolicyBody
}

export function useUpdateOrganizationNetworkPolicy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, settings }: UpdateNetworkPolicyVariables) =>
      requestJson(updateOrganizationNetworkPolicyContract, {
        params: { id: orgId },
        body: settings,
      }),
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: networkPolicyKeys.settings(orgId) })
    },
  })
}
