import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type BatchInvitationResult as BatchInvitationResultContract,
  batchWorkspaceInvitationsContract,
  cancelInvitationContract,
  getInvitationContract,
  listWorkspaceInvitationsContract,
  type PendingInvitationRow,
  removeWorkspaceMemberContract,
  resendInvitationContract,
} from '@/lib/api/contracts/invitations'
import { updateWorkspacePermissionsContract } from '@/lib/api/contracts/workspaces'
import { organizationKeys } from '@/hooks/queries/organization'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'

export const invitationKeys = {
  all: ['invitations'] as const,
  lists: () => [...invitationKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...invitationKeys.lists(), workspaceId] as const,
  details: () => [...invitationKeys.all, 'detail'] as const,
  detail: (invitationId: string, token: string | null) =>
    [...invitationKeys.details(), invitationId, token ?? ''] as const,
}

export const WORKSPACE_INVITATION_LIST_STALE_TIME = 30 * 1000
export const INVITATION_DETAILS_STALE_TIME = 30 * 1000

async function fetchInvitationDetails(
  invitationId: string,
  token: string | null,
  signal?: AbortSignal
) {
  return requestJson(getInvitationContract, {
    params: { id: invitationId },
    query: { token: token ?? undefined },
    signal,
  })
}

/**
 * Fetches an invitation (with the invitee-only join preview) for the accept
 * screen. `retry: false` preserves one-shot semantics — 403/404/expired
 * responses drive UX states and must surface immediately, not after backoff.
 */
export function useInvitationDetails(
  invitationId: string | undefined,
  token: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: invitationKeys.detail(invitationId ?? '', token),
    queryFn: ({ signal }) => fetchInvitationDetails(invitationId as string, token, signal),
    enabled: Boolean(invitationId) && (options?.enabled ?? true),
    staleTime: INVITATION_DETAILS_STALE_TIME,
    retry: false,
  })
}

export interface WorkspaceInvitation {
  email: string
  permissionType: 'admin' | 'write' | 'read'
  isPendingInvitation: boolean
  isExternal: boolean
  invitationId?: string
  token: string
}

async function fetchPendingInvitations(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceInvitation[]> {
  const data = await requestJson(listWorkspaceInvitationsContract, { signal })

  return (
    data.invitations
      ?.filter(
        (inv: PendingInvitationRow) => inv.status === 'pending' && inv.workspaceId === workspaceId
      )
      .map((inv: PendingInvitationRow) => ({
        email: inv.email,
        permissionType: inv.permission,
        isPendingInvitation: true,
        isExternal: inv.membershipIntent === 'external',
        invitationId: inv.id,
        token: inv.token,
      })) || []
  )
}

/**
 * Fetches pending invitations for a workspace.
 * @param workspaceId - The workspace ID to fetch invitations for
 */
export function usePendingInvitations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: invitationKeys.list(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchPendingInvitations(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_INVITATION_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

type BatchSendInvitationsParams = ContractBodyInput<typeof batchWorkspaceInvitationsContract> & {
  organizationId?: string | null
}

type BatchInvitationResult = Pick<BatchInvitationResultContract, 'successful' | 'failed'> & {
  added: string[]
}

/**
 * Sends workspace invitations through the server-side batch endpoint.
 * Returns results for each invitation indicating success or failure. Existing
 * organization members are added directly (no acceptance) and reported in
 * `added`; everyone else receives a pending invitation in `successful`.
 */
export function useBatchSendWorkspaceInvitations() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      invitations,
      membershipIntent,
    }: BatchSendInvitationsParams): Promise<BatchInvitationResult> => {
      const result = await requestJson(batchWorkspaceInvitationsContract, {
        body: {
          workspaceId,
          invitations,
          membershipIntent,
        },
      })

      return {
        successful: result.successful ?? [],
        added: result.added ?? [],
        failed: result.failed ?? [],
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.members(variables.workspaceId),
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.billing(variables.organizationId),
        })
      }
    },
  })
}

interface CancelInvitationParams {
  invitationId: string
  workspaceId: string
  organizationId?: string | null
}

/**
 * Cancels a pending workspace invitation.
 * Invalidates the invitation list cache on success.
 */
export function useCancelWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: CancelInvitationParams) => {
      return requestJson(cancelInvitationContract, {
        params: { id: invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.billing(variables.organizationId),
        })
      }
    },
  })
}

interface ResendInvitationParams {
  invitationId: string
  workspaceId: string
}

/**
 * Resends a pending workspace invitation email.
 * Invalidates the invitation list cache on success.
 */
export function useResendWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: ResendInvitationParams) => {
      return requestJson(resendInvitationContract, {
        params: { id: invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
    },
  })
}

type RemoveMemberParams = ContractBodyInput<typeof removeWorkspaceMemberContract> & {
  userId: string
  organizationId?: string | null
}

/**
 * Removes a member from a workspace.
 * Invalidates the workspace permissions cache on success.
 */
export function useRemoveWorkspaceMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, workspaceId }: RemoveMemberParams) => {
      return requestJson(removeWorkspaceMemberContract, {
        params: { id: userId },
        body: { workspaceId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.members(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.all,
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
      }
    },
  })
}

type LeaveWorkspaceParams = ContractBodyInput<typeof removeWorkspaceMemberContract> & {
  userId: string
}

/**
 * Allows the current user to leave a workspace.
 * Invalidates both permissions and workspace list caches on success.
 */
export function useLeaveWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, workspaceId }: LeaveWorkspaceParams) => {
      return requestJson(removeWorkspaceMemberContract, {
        params: { id: userId },
        body: { workspaceId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.detail(variables.workspaceId),
      })
    },
  })
}

type UpdatePermissionsParams = {
  workspaceId: string
  organizationId?: string
} & ContractBodyInput<typeof updateWorkspacePermissionsContract>

export function useUpdateWorkspacePermissions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, updates }: UpdatePermissionsParams) => {
      return requestJson(updateWorkspacePermissionsContract, {
        params: { id: workspaceId },
        body: { updates },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
      }
    },
  })
}
