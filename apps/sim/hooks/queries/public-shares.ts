import { toast } from '@sim/emcn'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AuthenticatePublicFileResponse,
  authenticatePublicFileContract,
  getFileShareContract,
  requestPublicFileOtpContract,
  type ShareRecord,
  type ShareResourceType,
  type UpsertFileShareBody,
  upsertFileShareContract,
  type VerifyPublicFileOtpResponse,
  verifyPublicFileOtpContract,
} from '@/lib/api/contracts/public-shares'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

export const RESOURCE_SHARE_STALE_TIME = 30 * 1000

/** The resource families the share modal can publish. Folders ride the file page and have no share UI. */
export type ShareableResourceType = Extract<ShareResourceType, 'file'>

/**
 * Query key factories for public shares.
 *
 * One namespace covers every shared resource family: `scopeId` is the workspace
 * the resource belongs to and `resourceId` the resource itself, so a workspace's
 * shares invalidate together under a single prefix.
 */
export const shareKeys = {
  all: ['publicShares'] as const,
  details: () => [...shareKeys.all, 'detail'] as const,
  detail: (resourceType: ShareResourceType, scopeId: string, resourceId: string) =>
    [...shareKeys.details(), resourceType, scopeId, resourceId] as const,
}

async function fetchFileShare(
  workspaceId: string,
  fileId: string,
  signal?: AbortSignal
): Promise<ShareRecord | null> {
  const data = await requestJson(getFileShareContract, {
    params: { id: workspaceId, fileId },
    signal,
  })
  return data.share
}

/**
 * The share record for any shareable resource. One hook serves every resource
 * family so the shared share modal cannot fork per resource: the query key and
 * the fetch both branch on the same `resourceType`, which is part of the key.
 */
export function useResourceShare(
  resourceType: ShareableResourceType,
  workspaceId: string,
  resourceId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: shareKeys.detail(resourceType, workspaceId, resourceId),
    queryFn: ({ signal }) => fetchFileShare(workspaceId, resourceId, signal),
    enabled: Boolean(workspaceId) && Boolean(resourceId) && (options?.enabled ?? true),
    staleTime: RESOURCE_SHARE_STALE_TIME,
  })
}

interface UpsertResourceShareVariables extends UpsertFileShareBody {
  resourceType: ShareableResourceType
  workspaceId: string
  resourceId: string
}

/**
 * Saves a share for any shareable resource. On success the detail cache is
 * seeded with the saved record, and the files list is refreshed because its rows
 * carry a share badge.
 */
export function useUpsertResourceShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      resourceType,
      workspaceId,
      resourceId,
      ...body
    }: UpsertResourceShareVariables) =>
      requestJson(upsertFileShareContract, {
        params: { id: workspaceId, fileId: resourceId },
        body,
      }),
    onSuccess: (data, { resourceType, workspaceId, resourceId }) => {
      queryClient.setQueryData(shareKeys.detail(resourceType, workspaceId, resourceId), data.share)
    },
    /**
     * Both the share record and the file row's share badge are reconciled on
     * failure: a partial failure — share written, response lost — would
     * otherwise leave the modal showing a pre-save record and the badge stale
     * until something else happened to invalidate them. On success `onSuccess`
     * already adopted the server's record, so only the list needs refreshing.
     */
    onSettled: (_data, error, { resourceType, workspaceId, resourceId }) => {
      if (error) {
        queryClient.invalidateQueries({
          queryKey: shareKeys.detail(resourceType, workspaceId, resourceId),
        })
      }
      if (resourceType === 'file') {
        queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

/**
 * Exchanges a share password for a `file_auth_{shareId}` cookie on the public
 * file page. On success the page should `router.refresh()` to re-render the
 * now-authorized viewer.
 */
export function usePublicFileAuth(token: string) {
  return useMutation<AuthenticatePublicFileResponse, Error, { password: string }>({
    mutationFn: ({ password }) =>
      requestJson(authenticatePublicFileContract, {
        params: { token },
        body: { password },
      }),
  })
}

/** Requests a verification code for an email-gated share (initial send + resend). */
export function usePublicFileOtpRequest(token: string) {
  return useMutation<{ message: string }, Error, { email: string }>({
    mutationFn: ({ email }) =>
      requestJson(requestPublicFileOtpContract, {
        params: { token },
        body: { email },
      }),
  })
}

/**
 * Verifies the OTP for an email-gated share. On success the server sets the
 * `file_auth_{shareId}` cookie; the page should then `router.refresh()`.
 */
export function usePublicFileOtpVerify(token: string) {
  return useMutation<VerifyPublicFileOtpResponse, Error, { email: string; otp: string }>({
    mutationFn: ({ email, otp }) =>
      requestJson(verifyPublicFileOtpContract, {
        params: { token },
        body: { email, otp },
      }),
  })
}
