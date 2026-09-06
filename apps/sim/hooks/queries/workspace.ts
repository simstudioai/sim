import type { QueryClient } from '@tanstack/react-query'
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  createPinnedItemContract,
  createWorkspaceContract,
  deletePinnedItemContract,
  deleteWorkspaceContract,
  getWorkspaceContract,
  getWorkspaceMembersContract,
  getWorkspacePermissionsContract,
  listWorkspacesContract,
  updateWorkspaceContract,
  type Workspace,
  type WorkspaceCreationPolicy,
  type WorkspaceMember,
  type WorkspacePermissions,
  type WorkspaceQueryScope,
  type WorkspacesResponse,
} from '@/lib/api/contracts'
import {
  normalizeWorkspace,
  normalizeWorkspacesResponse,
  WORKSPACE_LIST_STALE_TIME,
} from '@/hooks/queries/utils/workspace-list-query'

/**
 * Query key factory for workspace-related queries.
 * Provides hierarchical cache keys for workspaces, settings, and permissions.
 */
export const workspaceKeys = {
  all: ['workspace'] as const,
  lists: () => [...workspaceKeys.all, 'list'] as const,
  list: (scope: WorkspaceQueryScope = 'active') =>
    [...workspaceKeys.lists(), 'user', scope] as const,
  details: () => [...workspaceKeys.all, 'detail'] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
  settings: (id: string) => [...workspaceKeys.detail(id), 'settings'] as const,
  permissions: (id: string) => [...workspaceKeys.detail(id), 'permissions'] as const,
  members: (id: string) => [...workspaceKeys.detail(id), 'members'] as const,
  adminLists: () => [...workspaceKeys.all, 'adminList'] as const,
  adminList: (userId: string | undefined) => [...workspaceKeys.adminLists(), userId ?? ''] as const,
}

export type { Workspace, WorkspaceCreationPolicy, WorkspaceMember, WorkspacePermissions }

export const WORKSPACE_PERMISSIONS_STALE_TIME = 30 * 1000
export const WORKSPACE_SETTINGS_STALE_TIME = 30 * 1000
export const WORKSPACE_MEMBERS_STALE_TIME = 5 * 60 * 1000
export const WORKSPACE_ADMIN_LIST_STALE_TIME = 60 * 1000

async function fetchWorkspaces(
  scope: WorkspaceQueryScope = 'active',
  signal?: AbortSignal
): Promise<WorkspacesResponse> {
  const data = await requestJson(listWorkspacesContract, { query: { scope }, signal })
  return normalizeWorkspacesResponse(data)
}

const selectWorkspaces = (data: WorkspacesResponse): Workspace[] => data.workspaces

/**
 * Fetches the current user's workspaces.
 * Returns only the workspace array. Use `useWorkspacesWithMetadata` when
 * you also need `lastActiveWorkspaceId`.
 */
export function useWorkspacesQuery(enabled = true, scope: WorkspaceQueryScope = 'active') {
  return useQuery({
    queryKey: workspaceKeys.list(scope),
    queryFn: ({ signal }) => fetchWorkspaces(scope, signal),
    select: selectWorkspaces,
    enabled,
    staleTime: WORKSPACE_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetches workspaces with the user's last active workspace ID.
 * Used by the redirect page to determine which workspace to open.
 */
export function useWorkspacesWithMetadata(enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.list('active'),
    queryFn: ({ signal }) => fetchWorkspaces('active', signal),
    enabled,
    staleTime: WORKSPACE_LIST_STALE_TIME,
  })
}

export function useWorkspaceCreationPolicy(enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.list('active'),
    queryFn: ({ signal }) => fetchWorkspaces('active', signal),
    select: (data) => data.creationPolicy,
    enabled,
    staleTime: WORKSPACE_LIST_STALE_TIME,
  })
}

export const EMPTY_PINNED_WORKSPACE_IDS: ReadonlySet<string> = new Set()

const selectPinnedWorkspaceIds = (data: WorkspacesResponse): ReadonlySet<string> =>
  data.pinnedWorkspaceIds.length ? new Set(data.pinnedWorkspaceIds) : EMPTY_PINNED_WORKSPACE_IDS

/**
 * The viewer's pinned workspace ids, as a `Set` so a row resolves its pin state in
 * O(1) — mirroring {@link usePinnedIds} for the workspace-scoped kinds. Sourced
 * from the workspace list rather than `/api/pinned-items`; see
 * `pinnedResourceTypeSchema` for why that is the one kind read this way.
 */
export function usePinnedWorkspaceIds(enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.list('active'),
    queryFn: ({ signal }) => fetchWorkspaces('active', signal),
    select: selectPinnedWorkspaceIds,
    enabled,
    staleTime: WORKSPACE_LIST_STALE_TIME,
  })
}

/**
 * Identifies pin toggles in the mutation cache so `onSettled` can tell whether it is
 * the last one. Doubles as the `scope` id, which is what serializes them.
 */
const WORKSPACE_PIN_MUTATION_KEY = ['workspace', 'toggle-pin'] as const

/** Applies one toggle to a pin list. Idempotent, so replaying it cannot double-apply. */
function applyPinToggle(pinnedWorkspaceIds: string[], workspaceId: string, pinned: boolean) {
  const without = pinnedWorkspaceIds.filter((id) => id !== workspaceId)
  return pinned ? [...without, workspaceId] : without
}

/**
 * Pins or unpins a workspace in the switcher.
 *
 * A pin is one `pinned_item` row, so pinning inserts and unpinning deletes. Both
 * are idempotent against their own end state — a duplicate pin answers 409 and a
 * duplicate unpin answers 404, and each means the row is already how the caller
 * wants it, so neither is a failure to roll back.
 *
 * Ordering still matters, because pinning and unpinning the *same* workspace race
 * on the *same* row: an unpin that overtook its pin would delete nothing and leave
 * the workspace pinned. `scope` serializes them, and because TanStack runs
 * `onMutate` before the scope gate, the optimistic update is still immediate.
 */
export function useToggleWorkspacePin() {
  const queryClient = useQueryClient()
  const queryKey = workspaceKeys.list('active')

  return useMutation({
    mutationKey: WORKSPACE_PIN_MUTATION_KEY,
    scope: { id: 'workspace-pin' },
    mutationFn: async ({ workspaceId, pinned }: { workspaceId: string; pinned: boolean }) => {
      try {
        if (pinned) {
          await requestJson(createPinnedItemContract, {
            body: { workspaceId, resourceType: 'workspace', resourceId: workspaceId },
          })
        } else {
          await requestJson(deletePinnedItemContract, {
            params: { resourceType: 'workspace', resourceId: workspaceId },
          })
        }
      } catch (error) {
        const alreadyInEndState = pinned ? 409 : 404
        if (error instanceof ApiClientError && error.status === alreadyInEndState) return
        throw error
      }
    },
    onMutate: async ({ workspaceId, pinned }) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<WorkspacesResponse>(queryKey, (old) =>
        old
          ? {
              ...old,
              pinnedWorkspaceIds: applyPinToggle(old.pinnedWorkspaceIds, workspaceId, pinned),
            }
          : old
      )
    },
    /**
     * Undoes this toggle rather than restoring a snapshot: a snapshot taken before
     * a concurrent toggle would silently drop that one's optimistic state too.
     */
    onError: (_error, { workspaceId, pinned }) => {
      queryClient.setQueryData<WorkspacesResponse>(queryKey, (old) =>
        old
          ? {
              ...old,
              pinnedWorkspaceIds: applyPinToggle(old.pinnedWorkspaceIds, workspaceId, !pinned),
            }
          : old
      )
    },
    /**
     * Reconciles only once nothing is still queued. `scope` serializes the writes,
     * so an earlier toggle settles while a later one is still waiting its turn —
     * refetching there would render the server's intermediate state and bounce the
     * row out of the pinned group and back before the last write even leaves.
     *
     * Counted off the mutation cache rather than a ref because this module is
     * server-importable (`workspaceKeys` is read during SSR), so it cannot use hooks.
     */
    onSettled: () => {
      /**
       * `onSettled` runs before the mutation leaves `pending`, so it counts itself —
       * anything above one means a later toggle is still queued behind the scope.
       */
      if (queryClient.isMutating({ mutationKey: WORKSPACE_PIN_MUTATION_KEY }) > 1) return
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}

type CreateWorkspaceParams = Pick<ContractBodyInput<typeof createWorkspaceContract>, 'name'>

/**
 * Creates a new workspace.
 * Merges the created row into the active list cache before invalidation so navigation
 * cannot race a stale list (see workspace validation fallback in use-workspace-management).
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name }: CreateWorkspaceParams) => {
      const data = await requestJson(createWorkspaceContract, { body: { name } })
      return data.workspace
    },
    onSuccess: (newWorkspace) => {
      queryClient.setQueryData<WorkspacesResponse>(workspaceKeys.list('active'), (previous) => {
        if (!previous) {
          return {
            workspaces: [newWorkspace],
            lastActiveWorkspaceId: null,
            pinnedWorkspaceIds: [],
            creationPolicy: null,
          }
        }
        if (previous.workspaces.some((w) => w.id === newWorkspace.id)) {
          return previous
        }
        return { ...previous, workspaces: [newWorkspace, ...previous.workspaces] }
      })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.adminLists() })
    },
  })
}

interface DeleteWorkspaceParams {
  workspaceId: string
}

/**
 * Deletes a workspace.
 * Automatically invalidates the workspace list cache on success.
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId }: DeleteWorkspaceParams) => {
      return requestJson(deleteWorkspaceContract, {
        params: { id: workspaceId },
        body: {},
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(variables.workspaceId) })
    },
  })
}

type UpdateWorkspaceParams = { workspaceId: string } & Pick<
  ContractBodyInput<typeof updateWorkspaceContract>,
  'name' | 'logoUrl'
>

/**
 * Updates a workspace's properties (name, logo, etc.).
 * Invalidates both the workspace list and the specific workspace detail cache.
 */
export function useUpdateWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...updates }: UpdateWorkspaceParams) => {
      const body = updates.name !== undefined ? { ...updates, name: updates.name.trim() } : updates
      return requestJson(updateWorkspaceContract, { params: { id: workspaceId }, body })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(variables.workspaceId) })
    },
  })
}

async function fetchWorkspacePermissions(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspacePermissions> {
  try {
    return await requestJson(getWorkspacePermissionsContract, {
      params: { id: workspaceId },
      signal,
    })
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      throw new Error('Workspace not found or access denied', { cause: error })
    }
    if (error instanceof ApiClientError && error.status === 401) {
      throw new Error('Authentication required', { cause: error })
    }
    throw error
  }
}

/**
 * Fetches permissions for a specific workspace.
 * @param workspaceId - The workspace ID to fetch permissions for
 */
export function useWorkspacePermissionsQuery(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: workspaceKeys.permissions(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchWorkspacePermissions(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_PERMISSIONS_STALE_TIME,
  })
}

async function fetchWorkspaceMembers(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceMember[]> {
  const data = await requestJson(getWorkspaceMembersContract, {
    params: { id: workspaceId },
    signal,
  })
  return data.members
}

/**
 * Fetches lightweight member profiles (id, name, image) for a workspace.
 * Use this for display purposes (avatars, owner cells) instead of the heavier permissions query.
 */
export function useWorkspaceMembersQuery(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchWorkspaceMembers(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_MEMBERS_STALE_TIME,
  })
}

async function fetchWorkspaceSettings(workspaceId: string, signal?: AbortSignal) {
  const [settings, permissions] = await Promise.all([
    requestJson(getWorkspaceContract, { params: { id: workspaceId }, signal }),
    requestJson(getWorkspacePermissionsContract, { params: { id: workspaceId }, signal }),
  ])

  return {
    settings,
    permissions,
  }
}

/**
 * Prefetch a workspace's settings (and permissions) into the cache. Use on
 * hover to warm data before navigating to a settings-style route.
 * @param queryClient - The active QueryClient
 * @param workspaceId - The workspace ID to prefetch settings for
 */
export function prefetchWorkspaceSettings(queryClient: QueryClient, workspaceId: string) {
  if (!workspaceId) return
  queryClient.prefetchQuery(workspaceSettingsQueryOptions(workspaceId))
}

export function workspaceSettingsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKeys.settings(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceSettings(workspaceId, signal),
    staleTime: WORKSPACE_SETTINGS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

interface UseWorkspaceSettingsOptions {
  enabled?: boolean
}

/**
 * Fetches workspace settings including permissions.
 * @param workspaceId - The workspace ID to fetch settings for
 */
export function useWorkspaceSettings(workspaceId: string, options?: UseWorkspaceSettingsOptions) {
  return useQuery({
    ...workspaceSettingsQueryOptions(workspaceId),
    enabled: !!workspaceId && (options?.enabled ?? true),
  })
}

/** Workspace with admin access metadata. */
export interface AdminWorkspace {
  id: string
  name: string
  isOwner: boolean
  ownerId?: string
  canInvite: boolean
  organizationId: string | null
  workspaceMode: Workspace['workspaceMode']
}

async function fetchAdminWorkspaces(
  userId: string | undefined,
  organizationId: string | undefined,
  signal?: AbortSignal
): Promise<AdminWorkspace[]> {
  if (!userId) {
    return []
  }

  const workspacesData = await requestJson(listWorkspacesContract, { query: {}, signal })
  const allUserWorkspaces = workspacesData.workspaces.map(normalizeWorkspace)

  return allUserWorkspaces
    .filter((workspace: Workspace) => workspace.permissions === 'admin')
    .filter((workspace: Workspace) =>
      organizationId
        ? workspace.organizationId === organizationId && workspace.workspaceMode === 'organization'
        : true
    )
    .map((workspace: Workspace) => ({
      id: workspace.id,
      name: workspace.name,
      isOwner: workspace.ownerId === userId,
      ownerId: workspace.ownerId,
      canInvite: workspace.inviteMembersEnabled ?? false,
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
    }))
}

/**
 * Fetches workspaces where the user has admin access, optionally narrowed to
 * one organization's shared workspaces.
 * @param userId - The user ID to check admin access for
 * @param organizationId - Restrict to this organization's workspaces
 */
export function useAdminWorkspaces(
  userId: string | undefined,
  organizationId?: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: [...workspaceKeys.adminList(userId), organizationId ?? ''] as const,
    queryFn: ({ signal }) => fetchAdminWorkspaces(userId, organizationId, signal),
    enabled: Boolean(userId) && (options?.enabled ?? true),
    staleTime: WORKSPACE_ADMIN_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
