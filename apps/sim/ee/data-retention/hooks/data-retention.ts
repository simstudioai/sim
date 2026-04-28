'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface RetentionValues {
  logRetentionHours: number | null
  softDeleteRetentionHours: number | null
  taskCleanupHours: number | null
}

export interface DataRetentionResponse {
  isEnterprise: boolean
  defaults: RetentionValues
  configured: RetentionValues
  effective: RetentionValues
}

export const dataRetentionKeys = {
  all: ['dataRetention'] as const,
  settings: (orgId: string) => [...dataRetentionKeys.all, 'settings', orgId] as const,
}

async function fetchDataRetention(
  orgId: string,
  signal?: AbortSignal
): Promise<DataRetentionResponse> {
  const response = await fetch(`/api/organizations/${orgId}/data-retention`, { signal })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error ?? 'Failed to fetch data retention settings')
  }

  const { data } = await response.json()
  return data as DataRetentionResponse
}

export function useOrganizationRetention(orgId: string | undefined) {
  return useQuery({
    queryKey: dataRetentionKeys.settings(orgId ?? ''),
    queryFn: ({ signal }) => fetchDataRetention(orgId as string, signal),
    enabled: Boolean(orgId),
    staleTime: 60 * 1000,
  })
}

interface UpdateRetentionVariables {
  orgId: string
  settings: Partial<RetentionValues>
}

export function useUpdateOrganizationRetention() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, settings }: UpdateRetentionVariables) => {
      const response = await fetch(`/api/organizations/${orgId}/data-retention`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error ?? 'Failed to update data retention settings')
      }

      const { data } = await response.json()
      return data as DataRetentionResponse
    },
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: dataRetentionKeys.settings(orgId) })
    },
  })
}
