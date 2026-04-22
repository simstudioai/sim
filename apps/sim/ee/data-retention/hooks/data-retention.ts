'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlanCategory } from '@/lib/billing/plan-helpers'

export interface RetentionValues {
  logRetentionHours: number | null
  softDeleteRetentionHours: number | null
  taskCleanupHours: number | null
}

export interface DataRetentionResponse {
  plan: PlanCategory
  isEnterprise: boolean
  defaults: RetentionValues
  configured: RetentionValues
  effective: RetentionValues
}

export const dataRetentionKeys = {
  all: ['dataRetention'] as const,
  settings: (workspaceId: string) => [...dataRetentionKeys.all, 'settings', workspaceId] as const,
}

async function fetchDataRetention(
  workspaceId: string,
  signal?: AbortSignal
): Promise<DataRetentionResponse> {
  const response = await fetch(`/api/workspaces/${workspaceId}/data-retention`, { signal })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error ?? 'Failed to fetch data retention settings')
  }

  const { data } = await response.json()
  return data as DataRetentionResponse
}

export function useWorkspaceRetention(workspaceId: string | undefined) {
  return useQuery({
    queryKey: dataRetentionKeys.settings(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchDataRetention(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

interface UpdateRetentionVariables {
  workspaceId: string
  settings: Partial<RetentionValues>
}

export function useUpdateWorkspaceRetention() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, settings }: UpdateRetentionVariables) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/data-retention`, {
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
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: dataRetentionKeys.settings(workspaceId) })
    },
  })
}
