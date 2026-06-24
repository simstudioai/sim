'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  bulkAddPermissionGroupMembersContract,
  createPermissionGroupContract,
  deletePermissionGroupContract,
  getUserPermissionConfigContract,
  listOrganizationWorkspacesContract,
  listPermissionGroupMembersContract,
  listPermissionGroupsContract,
  type PermissionGroup,
  type PermissionGroupMember,
  type PermissionGroupWorkspaceRef,
  removePermissionGroupMemberContract,
  type UserPermissionConfig,
  updatePermissionGroupContract,
} from '@/lib/api/contracts'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'

export type {
  PermissionGroup,
  PermissionGroupMember,
  PermissionGroupWorkspaceRef,
  UserPermissionConfig,
}

export const permissionGroupKeys = {
  all: ['permissionGroups'] as const,
  lists: () => [...permissionGroupKeys.all, 'list'] as const,
  list: (organizationId?: string) =>
    [...permissionGroupKeys.lists(), organizationId ?? ''] as const,
  details: () => [...permissionGroupKeys.all, 'detail'] as const,
  detail: (organizationId?: string, id?: string) =>
    [...permissionGroupKeys.details(), organizationId ?? '', id ?? ''] as const,
  members: (organizationId?: string, id?: string) =>
    [...permissionGroupKeys.detail(organizationId, id), 'members'] as const,
  userConfig: (workspaceId?: string) =>
    [...permissionGroupKeys.all, 'userConfig', workspaceId ?? ''] as const,
  orgWorkspaces: (organizationId?: string) =>
    [...permissionGroupKeys.all, 'orgWorkspaces', organizationId ?? ''] as const,
}

export function usePermissionGroups(organizationId?: string, enabled = true) {
  return useQuery<PermissionGroup[]>({
    queryKey: permissionGroupKeys.list(organizationId),
    queryFn: async ({ signal }) => {
      if (!organizationId) return []
      const data = await requestJson(listPermissionGroupsContract, {
        params: { id: organizationId },
        signal,
      })
      return data.permissionGroups ?? []
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function usePermissionGroupMembers(organizationId?: string, permissionGroupId?: string) {
  return useQuery<PermissionGroupMember[]>({
    queryKey: permissionGroupKeys.members(organizationId, permissionGroupId),
    queryFn: async ({ signal }) => {
      if (!organizationId || !permissionGroupId) return []
      const data = await requestJson(listPermissionGroupMembersContract, {
        params: { id: organizationId, groupId: permissionGroupId },
        signal,
      })
      return data.members ?? []
    },
    enabled: Boolean(organizationId) && Boolean(permissionGroupId),
    staleTime: 30 * 1000,
  })
}

export function useOrganizationWorkspaces(organizationId?: string, enabled = true) {
  return useQuery<PermissionGroupWorkspaceRef[]>({
    queryKey: permissionGroupKeys.orgWorkspaces(organizationId),
    queryFn: async ({ signal }) => {
      if (!organizationId) return []
      const data = await requestJson(listOrganizationWorkspacesContract, {
        params: { id: organizationId },
        signal,
      })
      return data.workspaces
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useUserPermissionConfig(workspaceId?: string) {
  return useQuery<UserPermissionConfig>({
    queryKey: permissionGroupKeys.userConfig(workspaceId),
    queryFn: async ({ signal }) => {
      const data = await requestJson(getUserPermissionConfigContract, {
        query: { workspaceId: workspaceId ?? '' },
        signal,
      })
      return data
    },
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export interface CreatePermissionGroupData {
  organizationId: string
  name: string
  description?: string
  config?: Partial<PermissionGroupConfig>
  isDefault?: boolean
  workspaceIds?: string[]
}

export function useCreatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, ...data }: CreatePermissionGroupData) => {
      return requestJson(createPermissionGroupContract, {
        params: { id: organizationId },
        body: data,
      })
    },
    onSettled: (_data, _error, variables) => {
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
  isDefault?: boolean
  workspaceIds?: string[]
}

export function useUpdatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, organizationId, ...data }: UpdatePermissionGroupData) => {
      return requestJson(updatePermissionGroupContract, {
        params: { id: organizationId, groupId: id },
        body: data,
      })
    },
    onSettled: () => {
      // `all` is the prefix of every key in the factory (list/detail/members/userConfig),
      // so a single invalidation covers them — including the workspace-keyed userConfig
      // entries a mutation that only knows organizationId cannot target directly.
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
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
    mutationFn: async ({ permissionGroupId, organizationId }: DeletePermissionGroupParams) => {
      return requestJson(deletePermissionGroupContract, {
        params: { id: organizationId, groupId: permissionGroupId },
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
    },
  })
}

export function useRemovePermissionGroupMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      organizationId: string
      permissionGroupId: string
      memberId: string
    }) => {
      return requestJson(removePermissionGroupMemberContract, {
        params: { id: data.organizationId, groupId: data.permissionGroupId },
        query: { memberId: data.memberId },
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
    },
  })
}

export interface BulkAddMembersData {
  organizationId: string
  permissionGroupId: string
  userIds?: string[]
  addAllOrganizationMembers?: boolean
}

export function useBulkAddPermissionGroupMembers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, permissionGroupId, ...data }: BulkAddMembersData) => {
      return requestJson(bulkAddPermissionGroupMembersContract, {
        params: { id: organizationId, groupId: permissionGroupId },
        body: data,
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
    },
  })
}
