'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationWhitelabelContract,
  updateOrganizationWhitelabelContract,
} from '@/lib/api/contracts/organization'
import type { OrganizationWhitelabelSettings } from '@/lib/branding/types'
import { organizationKeys } from '@/hooks/queries/organization'

/** PUT payload — string fields accept null to clear a previously-set value. */
export type WhitelabelSettingsPayload = {
  [K in keyof OrganizationWhitelabelSettings]: OrganizationWhitelabelSettings[K] extends
    | string
    | undefined
    ? string | null
    : OrganizationWhitelabelSettings[K]
}

/**
 * Query key factories for whitelabel-related queries
 */
export const whitelabelKeys = {
  all: ['whitelabel'] as const,
  settings: (orgId: string) => [...whitelabelKeys.all, 'settings', orgId] as const,
}

async function fetchWhitelabelSettings(
  orgId: string,
  signal?: AbortSignal
): Promise<OrganizationWhitelabelSettings> {
  const { data } = await requestJson(getOrganizationWhitelabelContract, {
    params: { id: orgId },
    signal,
  })
  return data
}

/**
 * Hook to fetch whitelabel settings for an organization.
 */
export function useWhitelabelSettings(orgId: string | undefined) {
  return useQuery({
    queryKey: whitelabelKeys.settings(orgId ?? ''),
    queryFn: ({ signal }) => fetchWhitelabelSettings(orgId as string, signal),
    enabled: Boolean(orgId),
    staleTime: 60 * 1000,
  })
}

interface UpdateWhitelabelVariables {
  orgId: string
  settings: WhitelabelSettingsPayload
}

/**
 * Hook to update whitelabel settings for an organization.
 */
export function useUpdateWhitelabelSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, settings }: UpdateWhitelabelVariables) => {
      const result = await requestJson(updateOrganizationWhitelabelContract, {
        params: { id: orgId },
        body: settings,
      })
      return result.data
    },
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: whitelabelKeys.settings(orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(orgId) })
    },
  })
}
