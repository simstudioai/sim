import { toast } from '@sim/emcn'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AuthenticatePublicFileResponse,
  authenticatePublicFileContract,
  getFileShareContract,
  getInterfaceShareContract,
  requestPublicFileOtpContract,
  type ShareRecord,
  type ShareResourceType,
  type UpsertFileShareBody,
  upsertFileShareContract,
  upsertInterfaceShareContract,
  type VerifyPublicFileOtpResponse,
  verifyPublicFileOtpContract,
} from '@/lib/api/contracts/public-shares'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

export const RESOURCE_SHARE_STALE_TIME = 30 * 1000

/** The resource families the share modal can publish. Folders ride the file page and have no share UI. */
export type ShareableResourceType = Extract<ShareResourceType, 'file' | 'interface'>

/**
 * Query key factories for public shares.
 *
 * One namespace covers every shared resource family: `scopeId` is the workspace
 * the resource belongs to and `resourceId` the resource itself, so a workspace's
 * shares invalidate together under a single prefix.
 */
export const shareKeys = {
  all: ['publicShares'] as const,
  lists: () => [...shareKeys.all, 'list'] as const,
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

async function fetchInterfaceShare(
  workspaceId: string,
  interfaceId: string,
  signal?: AbortSignal
): Promise<ShareRecord | null> {
  const data = await requestJson(getInterfaceShareContract, {
    params: { interfaceId },
    query: { workspaceId },
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
    queryFn: ({ signal }) =>
      resourceType === 'file'
        ? fetchFileShare(workspaceId, resourceId, signal)
        : fetchInterfaceShare(workspaceId, resourceId, signal),
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
 * Saves a share for any shareable resource. Both routes accept the same body
 * shape ({@link UpsertFileShareBody}); the interface route additionally carries
 * `workspaceId` in the body. On success the detail cache is seeded with the
 * saved record; file saves also refresh the files list, whose rows carry a
 * share badge (the interfaces list carries none, so it needs no invalidation).
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
      resourceType === 'file'
        ? requestJson(upsertFileShareContract, {
            params: { id: workspaceId, fileId: resourceId },
            body,
          })
        : requestJson(upsertInterfaceShareContract, {
            params: { interfaceId: resourceId },
            body: { ...body, workspaceId },
          }),
    onSuccess: (data, { resourceType, workspaceId, resourceId }) => {
      queryClient.setQueryData(shareKeys.detail(resourceType, workspaceId, resourceId), data.share)
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
