'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  bulkAddPermissionGroupMembersContract,
  createPermissionGroupContract,
  deletePermissionGroupContract,
  getUserPermissionConfigContract,
  listPermissionGroupMembersContract,
  listPermissionGroupsContract,
  type PermissionGroup,
  type PermissionGroupMember,
  removePermissionGroupMemberContract,
  type UserPermissionConfig,
  updatePermissionGroupContract,
} from '@/lib/api/contracts'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'

export type { PermissionGroup, PermissionGroupMember, UserPermissionConfig }

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

export function usePermissionGroups(workspaceId?: string, enabled = true) {
  return useQuery<PermissionGroup[]>({
    queryKey: permissionGroupKeys.list(workspaceId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) return []
      const data = await requestJson(listPermissionGroupsContract, {
        params: { id: workspaceId },
        signal,
      })
      return data.permissionGroups ?? []
    },
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function usePermissionGroupMembers(workspaceId?: string, permissionGroupId?: string) {
  return useQuery<PermissionGroupMember[]>({
    queryKey: permissionGroupKeys.members(workspaceId, permissionGroupId),
    queryFn: async ({ signal }) => {
      if (!workspaceId || !permissionGroupId) return []
      const data = await requestJson(listPermissionGroupMembersContract, {
        params: { id: workspaceId, groupId: permissionGroupId },
        signal,
      })
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
      return requestJson(createPermissionGroupContract, {
        params: { id: workspaceId },
        body: data,
      })
    },
    onSettled: (_data, _error, variables) => {
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
      return requestJson(updatePermissionGroupContract, {
        params: { id: workspaceId, groupId: id },
        body: data,
      })
    },
    onSettled: (_data, _error, variables) => {
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
      return requestJson(deletePermissionGroupContract, {
        params: { id: workspaceId, groupId: permissionGroupId },
      })
    },
    onSettled: (_data, _error, variables) => {
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
      return requestJson(removePermissionGroupMemberContract, {
        params: { id: data.workspaceId, groupId: data.permissionGroupId },
        query: { memberId: data.memberId },
      })
    },
    onSettled: (_data, _error, variables) => {
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
      return requestJson(bulkAddPermissionGroupMembersContract, {
        params: { id: workspaceId, groupId: permissionGroupId },
        body: data,
      })
    },
    onSettled: (_data, _error, variables) => {
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
