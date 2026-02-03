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
}

export const permissionGroupKeys = {
  all: ['permissionGroups'] as const,
  list: (organizationId?: string) =>
    ['permissionGroups', 'list', organizationId ?? 'none'] as const,
  detail: (id?: string) => ['permissionGroups', 'detail', id ?? 'none'] as const,
  members: (id?: string) => ['permissionGroups', 'members', id ?? 'none'] as const,
  userConfig: (organizationId?: string) =>
    ['permissionGroups', 'userConfig', organizationId ?? 'none'] as const,
}

interface PermissionGroupsResponse {
  permissionGroups?: PermissionGroup[]
}

export function usePermissionGroups(organizationId?: string, enabled = true) {
  return useQuery<PermissionGroup[]>({
    queryKey: permissionGroupKeys.list(organizationId),
    queryFn: async () => {
      const data = await fetchJson<PermissionGroupsResponse>('/api/permission-groups', {
        searchParams: { organizationId: organizationId ?? '' },
      })
      return data.permissionGroups ?? []
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 60 * 1000,
  })
}

interface PermissionGroupDetailResponse {
  permissionGroup?: PermissionGroup
}

export function usePermissionGroup(id?: string, enabled = true) {
  return useQuery<PermissionGroup | null>({
    queryKey: permissionGroupKeys.detail(id),
    queryFn: async () => {
      const data = await fetchJson<PermissionGroupDetailResponse>(`/api/permission-groups/${id}`)
      return data.permissionGroup ?? null
    },
    enabled: Boolean(id) && enabled,
    staleTime: 60 * 1000,
  })
}

interface MembersResponse {
  members?: PermissionGroupMember[]
}

export function usePermissionGroupMembers(permissionGroupId?: string) {
  return useQuery<PermissionGroupMember[]>({
    queryKey: permissionGroupKeys.members(permissionGroupId),
    queryFn: async () => {
      const data = await fetchJson<MembersResponse>(
        `/api/permission-groups/${permissionGroupId}/members`
      )
      return data.members ?? []
    },
    enabled: Boolean(permissionGroupId),
    staleTime: 30 * 1000,
  })
}

export function useUserPermissionConfig(organizationId?: string) {
  return useQuery<UserPermissionConfig>({
    queryKey: permissionGroupKeys.userConfig(organizationId),
    queryFn: async () => {
      const data = await fetchJson<UserPermissionConfig>('/api/permission-groups/user', {
        searchParams: { organizationId: organizationId ?? '' },
      })
      return data
    },
    enabled: Boolean(organizationId),
    staleTime: 60 * 1000,
  })
}

export interface CreatePermissionGroupData {
  organizationId: string
  name: string
  description?: string
  config?: Partial<PermissionGroupConfig>
  autoAddNewMembers?: boolean
}

export function useCreatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreatePermissionGroupData) => {
      const response = await fetch('/api/permission-groups', {
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
        queryKey: permissionGroupKeys.list(variables.organizationId),
      })
    },
  })
}

export interface UpdatePermissionGroupData {
  id: string
  organizationId: string
  name?: string
  description?: string | null
  config?: Partial<PermissionGroupConfig>
  autoAddNewMembers?: boolean
}

export function useUpdatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdatePermissionGroupData) => {
      const response = await fetch(`/api/permission-groups/${id}`, {
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
        queryKey: permissionGroupKeys.list(variables.organizationId),
      })
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: ['permissionGroups', 'userConfig'] })
    },
  })
}

export interface DeletePermissionGroupParams {
  permissionGroupId: string
  organizationId: string
}

export function useDeletePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ permissionGroupId }: DeletePermissionGroupParams) => {
      const response = await fetch(`/api/permission-groups/${permissionGroupId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to delete permission group')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.list(variables.organizationId),
      })
      queryClient.invalidateQueries({ queryKey: ['permissionGroups', 'userConfig'] })
    },
  })
}

export function useAddPermissionGroupMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { permissionGroupId: string; userId: string }) => {
      const response = await fetch(`/api/permission-groups/${data.permissionGroupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.userId }),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to add member')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.members(variables.permissionGroupId),
      })
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
    },
  })
}

export function useRemovePermissionGroupMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { permissionGroupId: string; memberId: string }) => {
      const response = await fetch(
        `/api/permission-groups/${data.permissionGroupId}/members?memberId=${data.memberId}`,
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
        queryKey: permissionGroupKeys.members(variables.permissionGroupId),
      })
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['permissionGroups', 'userConfig'] })
    },
  })
}

export interface BulkAddMembersData {
  permissionGroupId: string
  userIds?: string[]
  addAllOrgMembers?: boolean
}

export function useBulkAddPermissionGroupMembers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ permissionGroupId, ...data }: BulkAddMembersData) => {
      const response = await fetch(`/api/permission-groups/${permissionGroupId}/members/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to add members')
      }
      return response.json() as Promise<{ added: number; moved: number }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionGroupKeys.members(variables.permissionGroupId),
      })
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['permissionGroups', 'userConfig'] })
    },
  })
}
