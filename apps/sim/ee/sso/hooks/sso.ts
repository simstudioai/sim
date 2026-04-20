'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { organizationKeys } from '@/hooks/queries/organization'

/**
 * Query key factories for SSO-related queries
 */
export const ssoKeys = {
  all: ['sso'] as const,
  providers: () => [...ssoKeys.all, 'providers'] as const,
}

/**
 * Fetch SSO providers
 */
async function fetchSSOProviders(signal: AbortSignal, organizationId?: string) {
  const url = organizationId
    ? `/api/auth/sso/providers?organizationId=${encodeURIComponent(organizationId)}`
    : '/api/auth/sso/providers'
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error('Failed to fetch SSO providers')
  }
  return response.json()
}

/**
 * Hook to fetch SSO providers
 */
interface UseSSOProvidersOptions {
  enabled?: boolean
  organizationId?: string
}

export function useSSOProviders({ enabled = true, organizationId }: UseSSOProvidersOptions = {}) {
  return useQuery({
    queryKey: [...ssoKeys.providers(), organizationId ?? ''],
    queryFn: ({ signal }) => fetchSSOProviders(signal, organizationId),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Configure SSO provider mutation
 */
type ConfigureSSOParams = Record<string, unknown>

export function useConfigureSSO() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (config: ConfigureSSOParams) => {
      const response = await fetch('/api/auth/sso/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || error.details || 'Failed to configure SSO')
      }

      return response.json()
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ssoKeys.providers() })

      const orgId = typeof variables.orgId === 'string' ? variables.orgId : undefined
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: organizationKeys.detail(orgId) })
        queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      }
    },
  })
}
