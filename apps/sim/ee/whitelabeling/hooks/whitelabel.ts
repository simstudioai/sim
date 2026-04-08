'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  const response = await fetch(`/api/organizations/${orgId}/whitelabel`, { signal })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error ?? 'Failed to fetch whitelabel settings')
  }

  const { data } = await response.json()
  return data as OrganizationWhitelabelSettings
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
      const response = await fetch(`/api/organizations/${orgId}/whitelabel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error ?? 'Failed to update whitelabel settings')
      }

      const { data } = await response.json()
      return data as OrganizationWhitelabelSettings
    },
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: whitelabelKeys.settings(orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(orgId) })
    },
  })
}
