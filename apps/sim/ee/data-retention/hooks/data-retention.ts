'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationDataRetentionContract,
  updateOrganizationDataRetentionContract,
} from '@/lib/api/contracts/organization'

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
  const { data } = await requestJson(getOrganizationDataRetentionContract, {
    params: { id: orgId },
    signal,
  })
  return data
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
    mutationFn: ({ orgId, settings }: UpdateRetentionVariables) =>
      requestJson(updateOrganizationDataRetentionContract, {
        params: { id: orgId },
        body: settings,
      }),
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: dataRetentionKeys.settings(orgId) })
    },
  })
}
