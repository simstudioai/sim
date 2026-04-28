'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { fetchJson } from '@/hooks/selectors/helpers'

export interface PermissionGroup {
  id: string
  name: string
  description: string | null
  config: PermissionGroupConfig
  createdBy: string
  createdAt: string
  updatedAt: string
  creatorName: string | null
  creatorEmail: string | null
  memberCount: number
  autoAddNewMembers: boolean
}

export interface PermissionGroupMember {
  id: string
  userId: string
  assignedAt: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
}

export interface UserPermissionConfig {
  permissionGroupId: string | null
  groupName: string | null
  config: PermissionGroupConfig | null
  entitled: boolean
}

export const permissionGroupKeys = {
  all: ['permissionGroups'] as const,
  lists: () => [...permissionGroupKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...permissionGroupKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...permissionGroupKeys.all, 'detail'] as const,
  detail: (workspaceId?: string, id?: string) =>
    [...permissionGroupKeys.details(), workspaceId ?? '', id ?? ''] as const,
  members: (workspaceId?: string, id?: string) =>
    [...permissionGroupKeys.detail(workspaceId, id), 'members'] as const,
  userConfig: (workspaceId?: string) =>
    [...permissionGroupKeys.all, 'userConfig', workspaceId ?? ''] as const,
}

interface PermissionGroupsResponse {
  permissionGroups?: PermissionGroup[]
}

export function usePermissionGroups(workspaceId?: string, enabled = true) {
  return useQuery<PermissionGroup[]>({
    queryKey: permissionGroupKeys.list(workspaceId),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<PermissionGroupsResponse>(
        `/api/workspaces/${workspaceId}/permission-groups`,
        { signal }
      )
      return data.permissionGroups ?? []
    },
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60 * 1000,
  })
}

interface MembersResponse {
  members?: PermissionGroupMember[]
}

export function usePermissionGroupMembers(workspaceId?: string, permissionGroupId?: string) {
  return useQuery<PermissionGroupMember[]>({
    queryKey: permissionGroupKeys.members(workspaceId, permissionGroupId),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<MembersResponse>(
        `/api/workspaces/${workspaceId}/permission-groups/${permissionGroupId}/members`,
        { signal }
      )
      return data.members ?? []
    },
    enabled: Boolean(workspaceId) && Boolean(permissionGroupId),
    staleTime: 30 * 1000,
  })
}

export function useUserPermissionConfig(workspaceId?: string) {
  return useQuery<UserPermissionConfig>({
    queryKey: permissionGroupKeys.userConfig(workspaceId),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<UserPermissionConfig>('/api/permission-groups/user', {
        searchParams: { workspaceId: workspaceId ?? '' },
        signal,
      })
      return data
    },
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export interface CreatePermissionGroupData {
  workspaceId: string
  name: string
  description?: string
  config?: Partial<PermissionGroupConfig>
  autoAddNewMembers?: boolean
}

export function useCreatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...data }: CreatePermissionGroupData) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/permission-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to create permission group')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.list(variables.workspaceId),
      })
    },
  })
}

export interface UpdatePermissionGroupData {
  id: string
  workspaceId: string
  name?: string
  description?: string | null
  config?: Partial<PermissionGroupConfig>
  autoAddNewMembers?: boolean
}

export function useUpdatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, workspaceId, ...data }: UpdatePermissionGroupData) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/permission-groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to update permission group')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.list(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.detail(variables.workspaceId, variables.id),
      })
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.userConfig(variables.workspaceId),
      })
    },
  })
}

export interface DeletePermissionGroupParams {
  permissionGroupId: string
  workspaceId: string
}

export function useDeletePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ permissionGroupId, workspaceId }: DeletePermissionGroupParams) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/permission-groups/${permissionGroupId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to delete permission group')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.list(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.userConfig(variables.workspaceId),
      })
    },
  })
}

export function useRemovePermissionGroupMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string
      permissionGroupId: string
      memberId: string
    }) => {
      const response = await fetch(
        `/api/workspaces/${data.workspaceId}/permission-groups/${data.permissionGroupId}/members?memberId=${data.memberId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to remove member')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.members(variables.workspaceId, variables.permissionGroupId),
      })
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.list(variables.workspaceId) })
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.userConfig(variables.workspaceId),
      })
    },
  })
}

export interface BulkAddMembersData {
  workspaceId: string
  permissionGroupId: string
  userIds?: string[]
  addAllWorkspaceMembers?: boolean
}

export function useBulkAddPermissionGroupMembers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, permissionGroupId, ...data }: BulkAddMembersData) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/permission-groups/${permissionGroupId}/members/bulk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to add members')
      }
      return response.json() as Promise<{ added: number; moved: number }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.members(variables.workspaceId, variables.permissionGroupId),
      })
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.list(variables.workspaceId) })
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.userConfig(variables.workspaceId),
      })
    },
  })
}
