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
async function fetchSSOProviders() {
  const response = await fetch('/api/auth/sso/providers')
  if (!response.ok) {
    throw new Error('Failed to fetch SSO providers')
  }
  return response.json()
}

/**
 * Hook to fetch SSO providers
 */
export function useSSOProviders() {
  return useQuery({
    queryKey: ssoKeys.providers(),
    queryFn: fetchSSOProviders,
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: keepPreviousData,
  })
}

/**
 * Configure SSO provider mutation
 */
interface ConfigureSSOParams {
  provider: string
  domain: string
  clientId: string
  clientSecret: string
  orgId?: string
}

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
        throw new Error(error.message || 'Failed to configure SSO')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ssoKeys.providers() })

      if (variables.orgId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.detail(variables.orgId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.lists(),
        })
      }
    },
  })
}

/**
 * Delete SSO provider mutation
 */
interface DeleteSSOParams {
  providerId: string
  orgId?: string
}

export function useDeleteSSO() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ providerId }: DeleteSSOParams) => {
      const response = await fetch(`/api/auth/sso/providers/${providerId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to delete SSO provider')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ssoKeys.providers() })

      if (variables.orgId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.detail(variables.orgId),
        })
      }
    },
  })
}
