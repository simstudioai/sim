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
  getPermissionGroupEditorCatalogContract,
  getUserPermissionConfigContract,
  listOrganizationWorkspacesContract,
  listPermissionGroupMembersContract,
  listPermissionGroupsContract,
  type PermissionGroup,
  type PermissionGroupMember,
  type PermissionGroupWorkspaceRef,
  type PermissionGroupWrite,
  type RemovePermissionGroupMemberQuery,
  removePermissionGroupMemberContract,
  type UpdatePermissionGroupBody,
  type UserPermissionConfig,
  updatePermissionGroupContract,
} from '@/lib/api/contracts/permission-groups'
import { accessRequestKeys } from '@/hooks/queries/utils/access-request-keys'
import {
  PERMISSION_GROUP_EDITOR_CATALOG_STALE_TIME,
  PERMISSION_GROUP_MEMBERS_STALE_TIME,
  PERMISSION_GROUPS_STALE_TIME,
  permissionGroupKeys,
} from '@/hooks/queries/utils/permission-group-keys'
import { shouldRetrySettingsRead } from '@/hooks/queries/utils/settings-read-retry'

export type {
  PermissionGroup,
  PermissionGroupMember,
  PermissionGroupWorkspaceRef,
  UserPermissionConfig,
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
    retry: shouldRetrySettingsRead,
    retryOnMount: true,
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

/** The group editor's block and provider catalog; requires organization admin, like the groups. */
export function usePermissionGroupEditorCatalog(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: permissionGroupKeys.editorCatalog(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getPermissionGroupEditorCatalogContract, {
        params: { id: organizationId },
        signal,
      }),
    enabled: Boolean(organizationId) && enabled,
    staleTime: PERMISSION_GROUP_EDITOR_CATALOG_STALE_TIME,
    retry: shouldRetrySettingsRead,
    retryOnMount: true,
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

export function useUserPermissionConfig(
  workspaceId?: string,
  options?: { refetchInterval?: number | false; refetchOnWindowFocus?: boolean }
) {
  return useQuery<UserPermissionConfig>({
    ...options,
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
    onSettled: (_data, _error, { organizationId }) => {
      void queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      void queryClient.invalidateQueries({
        queryKey: accessRequestKeys.organizationDetails(organizationId),
      })
    },
  })
}

type UpdatePermissionGroupVariables = UpdatePermissionGroupBody & {
  id: string
  organizationId: string
}

/** Every in-flight group update, so only the last one to settle reconciles the cache. */
const UPDATE_PERMISSION_GROUP_MUTATION_KEY = [...permissionGroupKeys.all, 'update'] as const

/** The group as the server will hold it after `patch`, with its workspaces named from `known`. */
function applyPermissionGroupPatch(
  group: PermissionGroup,
  patch: Omit<PermissionGroupWrite, 'id' | 'organizationId'> | UpdatePermissionGroupBody,
  known: readonly PermissionGroupWorkspaceRef[]
): PermissionGroup {
  const workspaceIds = 'workspaceIds' in patch ? patch.workspaceIds : undefined
  const isDefault = patch.isDefault ?? group.isDefault
  const named = workspaceIds
    ? workspaceIds.flatMap(
        (id) =>
          known.find((workspace) => workspace.id === id) ??
          group.workspaces.find((workspace) => workspace.id === id) ??
          []
      )
    : group.workspaces
  return {
    ...group,
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
    ...(patch.config !== undefined && { config: { ...group.config, ...patch.config } }),
    isDefault,
    workspaces: isDefault ? [] : named,
  }
}

/**
 * Updates a group, showing the change in the organization's group list at once. A failed write
 * restores the list it replaced; the server's copy, then a refetch, settle the last write.
 */
export function useUpdatePermissionGroup() {
  const queryClient = useQueryClient()

  /** Applies `patch` to the group, and clears the default elsewhere when it becomes the default. */
  function patchList(
    organizationId: string,
    id: string,
    patch: Parameters<typeof applyPermissionGroupPatch>[1]
  ) {
    const known =
      queryClient.getQueryData<PermissionGroupWorkspaceRef[]>(
        permissionGroupKeys.orgWorkspaces(organizationId)
      ) ?? []
    queryClient.setQueryData<PermissionGroup[]>(
      permissionGroupKeys.list(organizationId),
      (groups) =>
        groups?.map((group) =>
          group.id === id
            ? applyPermissionGroupPatch(group, patch, known)
            : patch.isDefault === true && group.isDefault
              ? { ...group, isDefault: false }
              : group
        )
    )
  }

  const isLastUpdate = () =>
    queryClient.isMutating({ mutationKey: UPDATE_PERMISSION_GROUP_MUTATION_KEY }) === 1

  return useMutation({
    mutationKey: UPDATE_PERMISSION_GROUP_MUTATION_KEY,
    mutationFn: async ({ id, organizationId, ...data }: UpdatePermissionGroupVariables) => {
      return requestJson(updatePermissionGroupContract, {
        params: { id: organizationId, groupId: id },
        body: data,
      })
    },
    onMutate: async ({ id, organizationId, ...patch }) => {
      const listKey = permissionGroupKeys.list(organizationId)
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<PermissionGroup[]>(listKey)
      patchList(organizationId, id, patch)
      return { previous }
    },
    onSuccess: ({ permissionGroup }, { id, organizationId }) => {
      // The server's copy, so a normalization cannot leave a baseline never persisted.
      if (isLastUpdate()) patchList(organizationId, id, permissionGroup)
    },
    onError: (_error, { organizationId }, context) => {
      if (context?.previous && isLastUpdate())
        queryClient.setQueryData(permissionGroupKeys.list(organizationId), context.previous)
    },
    onSettled: (_data, _error, { organizationId }) => {
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      void queryClient.invalidateQueries({
        queryKey: accessRequestKeys.organizationDetails(organizationId),
      })
      // A refetch while a newer write is in flight would paint the list without it.
      if (!isLastUpdate()) return
      // `all` is the prefix of every key in the factory (list/detail/members/userConfig),
      // so a single invalidation covers them — including the workspace-keyed userConfig
      // entries a mutation that only knows organizationId cannot target directly.
      void queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
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
    onSettled: (_data, _error, { organizationId }) => {
      void queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      void queryClient.invalidateQueries({
        queryKey: accessRequestKeys.organizationDetails(organizationId),
      })
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
    onSettled: (_data, _error, { organizationId }) => {
      void queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      void queryClient.invalidateQueries({
        queryKey: accessRequestKeys.organizationDetails(organizationId),
      })
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
    onSettled: (_data, _error, { organizationId }) => {
      void queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      void queryClient.invalidateQueries({
        queryKey: accessRequestKeys.organizationDetails(organizationId),
      })
    },
  })
}
