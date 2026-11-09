import { getErrorMessage } from '@sim/utils/errors'
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { extractValidationIssues } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type BatchInvitationResult as BatchInvitationResultContract,
  type BatchWorkspaceInvitationBody,
  batchWorkspaceInvitationsContract,
  cancelInvitationContract,
  getInvitationContract,
  listWorkspaceInvitationsContract,
  type PendingInvitationRow,
  removeWorkspaceMemberContract,
  resendInvitationContract,
} from '@/lib/api/contracts/invitations'
import { updateWorkspacePermissionsContract } from '@/lib/api/contracts/workspaces'
import { toast } from '@/lib/toast/sink'
import { organizationKeys } from '@/hooks/queries/organization'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'

const invitationKeys = {
  all: ['invitations'] as const,
  lists: () => [...invitationKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...invitationKeys.lists(), workspaceId] as const,
  details: () => [...invitationKeys.all, 'detail'] as const,
  /**
   * Scoped by viewer: the response is viewer-dependent (the join preview is
   * invitee-only, and authorization differs per account), so a cached entry
   * must never be reused across a sign-out/sign-in on the same invite link —
   * doing so would let a stale "nothing moves" preview become the disclosure
   * basis for a different user.
   */
  detail: (invitationId: string, token: string | null, viewerId: string | null) =>
    [...invitationKeys.details(), invitationId, token ?? '', viewerId ?? ''] as const,
  mine: () => [...invitationKeys.all, 'mine'] as const,
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
  viewerId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: invitationKeys.detail(invitationId ?? '', token, viewerId),
    queryFn: ({ signal }) => fetchInvitationDetails(invitationId as string, token, signal),
    enabled: Boolean(invitationId) && (options?.enabled ?? true),
    staleTime: INVITATION_DETAILS_STALE_TIME,
    retry: false,
  })
}

interface WorkspaceInvitation {
  email: string
  permissionType: 'admin' | 'write' | 'read'
  isPendingInvitation: boolean
  isExternal: boolean
  invitationId?: string
  /** Absent unless the viewer may manage the workspace; the copy-link action is gated on it. */
  token?: string
}

async function fetchPendingInvitations(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceInvitation[]> {
  const data = await requestJson(listWorkspaceInvitationsContract, { signal })

  return (
    data.invitations
      /** The server returns pending rows only; the status check stays as a cheap contract guard. */
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

function pendingInvitationsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: invitationKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchPendingInvitations(workspaceId, signal),
    staleTime: WORKSPACE_INVITATION_LIST_STALE_TIME,
    retryOnMount: true,
  })
}

/**
 * Fetches pending invitations for a workspace.
 * @param workspaceId - The workspace ID to fetch invitations for
 */
export function usePendingInvitations(workspaceId: string | undefined) {
  return useQuery({
    ...pendingInvitationsQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  })
}

export const MY_INVITATIONS_STALE_TIME = 30 * 1000

type SendInvitationsParams = Omit<BatchWorkspaceInvitationBody, 'organizationId'> & {
  organizationId?: string | null
}

type SendInvitationsResult = Pick<BatchInvitationResultContract, 'successful' | 'added' | 'failed'>

/**
 * Sends invitations for one or more workspaces. Existing organization members
 * are added directly (no acceptance) and reported in `added`; everyone else
 * receives a single pending invitation covering every selected workspace and
 * is reported in `successful`.
 */
export function useSendWorkspaceInvitations() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceIds,
      emails,
      permission,
      membership,
      organizationId,
    }: SendInvitationsParams): Promise<SendInvitationsResult> => {
      const result = await requestJson(batchWorkspaceInvitationsContract, {
        body: {
          workspaceIds,
          emails,
          permission,
          membership,
          organizationId: organizationId ?? undefined,
        },
      })

      return {
        successful: result.successful,
        added: result.added,
        failed: result.failed,
      }
    },
    onSettled: (_data, _error, variables) => {
      for (const workspaceId of variables.workspaceIds) {
        queryClient.invalidateQueries({ queryKey: invitationKeys.list(workspaceId) })
        queryClient.invalidateQueries({ queryKey: workspaceKeys.permissions(workspaceId) })
        queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) })
      }
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.billing(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.detail(variables.organizationId),
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
 * Withdraws one workspace's grant from a pending invitation.
 *
 * Scoped to `workspaceId` because an invitation can span several workspaces and
 * a workspace's member list only has authority over its own access. The
 * invitation is cancelled outright only when this was its last grant — see
 * `useCancelInvitation` in `organization.ts` for revoking an entire invitation.
 */
export function useCancelWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId, workspaceId }: CancelInvitationParams) => {
      return requestJson(cancelInvitationContract, {
        params: { id: invitationId },
        query: { workspaceId },
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
    /**
     * The route rejects a role change whose target is no longer a member, or
     * whose standing changed mid-request. Surfaced here rather than per caller
     * so the invalidation below cannot silently revert the control the user
     * just moved with no explanation.
     */
    onError: (error) => {
      /**
       * `requestJson` validates the body against the contract before it fetches,
       * so a contract failure arrives as a raw `ZodError` whose `message` is the
       * serialized issue array. Read the issue instead, which is where the
       * authored message lives on both that path and the server's `details`.
       */
      const issue = extractValidationIssues(error)[0]?.message
      toast.error("Couldn't update role", {
        description: issue ?? getErrorMessage(error, 'Please try again in a moment.'),
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
