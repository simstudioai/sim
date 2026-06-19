'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationDataRetentionContract,
  type OrganizationDataRetention,
  type OrganizationRetentionValues,
  updateOrganizationDataRetentionContract,
} from '@/lib/api/contracts/organization'
import {
  getWorkspaceDataRetentionContract,
  type UpdateWorkspaceDataRetentionBody,
  updateWorkspaceDataRetentionContract,
  type WorkspaceDataRetention,
} from '@/lib/api/contracts/workspaces'

export type RetentionValues = OrganizationRetentionValues
export type DataRetentionResponse = OrganizationDataRetention
export type WorkspaceDataRetentionResponse = WorkspaceDataRetention

export const dataRetentionKeys = {
  all: ['dataRetention'] as const,
  settings: (orgId: string) => [...dataRetentionKeys.all, 'settings', orgId] as const,
  workspaceSettings: (workspaceId: string) =>
    [...dataRetentionKeys.all, 'workspace', workspaceId] as const,
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

async function fetchWorkspaceDataRetention(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceDataRetentionResponse> {
  const { data } = await requestJson(getWorkspaceDataRetentionContract, {
    params: { id: workspaceId },
    signal,
  })
  return data
}

export function useWorkspaceRetention(workspaceId: string | undefined) {
  return useQuery({
    queryKey: dataRetentionKeys.workspaceSettings(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchWorkspaceDataRetention(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

interface UpdateWorkspaceRetentionVariables {
  workspaceId: string
  settings: UpdateWorkspaceDataRetentionBody
}

export function useUpdateWorkspaceRetention() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ workspaceId, settings }: UpdateWorkspaceRetentionVariables) =>
      requestJson(updateWorkspaceDataRetentionContract, {
        params: { id: workspaceId },
        body: settings,
      }),
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: dataRetentionKeys.workspaceSettings(workspaceId),
      })
    },
  })
}
