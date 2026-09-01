'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type BulkAddPermissionGroupMembersBody,
  bulkAddPermissionGroupMembersContract,
  type CreatePermissionGroupBody,
  createPermissionGroupContract,
  deletePermissionGroupContract,
  getUserPermissionConfigContract,
  listOrganizationWorkspacesContract,
  listPermissionGroupMembersContract,
  listPermissionGroupsContract,
  type PermissionGroup,
  type PermissionGroupMember,
  type PermissionGroupWorkspaceRef,
  type RemovePermissionGroupMemberQuery,
  removePermissionGroupMemberContract,
  type UpdatePermissionGroupBody,
  type UserPermissionConfig,
  updatePermissionGroupContract,
} from '@/lib/api/contracts'

export const PERMISSION_GROUP_MEMBERS_STALE_TIME = 30 * 1000
export const PERMISSION_GROUPS_STALE_TIME = 60 * 1000

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
    staleTime: PERMISSION_GROUPS_STALE_TIME,
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
    staleTime: PERMISSION_GROUP_MEMBERS_STALE_TIME,
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
    staleTime: PERMISSION_GROUPS_STALE_TIME,
  })
}

/**
 * How many times a failed policy read is retried before the UI is left with no
 * answer, and the app default this raises it from.
 *
 * Consumers of this query fail CLOSED — the API-keys page withholds the create
 * button until the read succeeds, because offering a key type the server would
 * refuse is the only failure worth avoiding. That makes an unanswered question
 * a withheld capability, and the client's default query options give it no way
 * back: `retry: 1` on the web, `retryOnMount: false`, and `refetchOnWindowFocus`
 * off outside the desktop app. One transient failure would otherwise disable
 * the button for the rest of the session with nothing to say why.
 *
 * The read is a small, idempotent, cacheable GET, so retrying it is close to
 * free — cheap enough to justify self-healing rather than a page reload.
 */
const USER_PERMISSION_CONFIG_RETRIES = 3

/**
 * A refusal will not heal by asking again: the caller's session or membership
 * is what the server disagrees with, and three more requests spend latency to
 * arrive at the same 4xx. Only a transport failure or a 5xx is worth a retry.
 *
 * Stated as "a 5xx and nothing else" rather than "not a 4xx". `requestJson`
 * raises an `ApiClientError` carrying the response status for a body that fails
 * contract validation too, and that status is a `200` — deterministic, and
 * outside the 4xx band the narrower test would have let through.
 */
function retryUserPermissionConfig(failureCount: number, error: Error): boolean {
  if (isApiClientError(error) && (error.status < 500 || error.status >= 600)) return false
  return failureCount < USER_PERMISSION_CONFIG_RETRIES
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
    staleTime: PERMISSION_GROUPS_STALE_TIME,
    retry: retryUserPermissionConfig,
    /**
     * The self-heal. Without it a query left in error stays there for the life
     * of the browser session, because nothing else remounts it back to life:
     * `refetchOnWindowFocus` is off on the web, and the settings modal
     * unmounting and reopening is exactly the moment a user retries by hand.
     */
    retryOnMount: true,
  })
}

type CreatePermissionGroupVariables = CreatePermissionGroupBody & { organizationId: string }

export function useCreatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, ...data }: CreatePermissionGroupVariables) => {
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

type UpdatePermissionGroupVariables = UpdatePermissionGroupBody & {
  id: string
  organizationId: string
}

export function useUpdatePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, organizationId, ...data }: UpdatePermissionGroupVariables) => {
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

interface DeletePermissionGroupVariables {
  permissionGroupId: string
  organizationId: string
}

export function useDeletePermissionGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ permissionGroupId, organizationId }: DeletePermissionGroupVariables) => {
      return requestJson(deletePermissionGroupContract, {
        params: { id: organizationId, groupId: permissionGroupId },
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
    },
  })
}

type RemovePermissionGroupMemberVariables = RemovePermissionGroupMemberQuery & {
  organizationId: string
  permissionGroupId: string
}

export function useRemovePermissionGroupMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: RemovePermissionGroupMemberVariables) => {
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

type BulkAddPermissionGroupMembersVariables = BulkAddPermissionGroupMembersBody & {
  organizationId: string
  permissionGroupId: string
}

export function useBulkAddPermissionGroupMembers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      organizationId,
      permissionGroupId,
      ...data
    }: BulkAddPermissionGroupMembersVariables) => {
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
