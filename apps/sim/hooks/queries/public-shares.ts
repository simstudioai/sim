import { toast } from '@sim/emcn'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AuthenticatePublicFileResponse,
  authenticatePublicFileContract,
  getFileShareContract,
  requestPublicFileOtpContract,
  type ShareRecord,
  type UpsertFileShareBody,
  upsertFileShareContract,
  type VerifyPublicFileOtpResponse,
  verifyPublicFileOtpContract,
} from '@/lib/api/contracts/public-shares'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

export const FILE_SHARE_STALE_TIME = 30 * 1000

/**
 * Query key factories for public shares
 */
export const shareKeys = {
  all: ['publicShares'] as const,
  details: () => [...shareKeys.all, 'detail'] as const,
  detail: (workspaceId: string, fileId: string) =>
    [...shareKeys.details(), workspaceId, fileId] as const,
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

export function useFileShare(workspaceId: string, fileId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: shareKeys.detail(workspaceId, fileId),
    queryFn: ({ signal }) => fetchFileShare(workspaceId, fileId, signal),
    enabled: Boolean(workspaceId) && Boolean(fileId) && (options?.enabled ?? true),
    staleTime: FILE_SHARE_STALE_TIME,
  })
}

interface UpsertFileShareVariables extends UpsertFileShareBody {
  workspaceId: string
  fileId: string
}

export function useUpsertFileShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, fileId, ...body }: UpsertFileShareVariables) =>
      requestJson(upsertFileShareContract, {
        params: { id: workspaceId, fileId },
        body,
      }),
    onSuccess: (data, { workspaceId, fileId }) => {
      queryClient.setQueryData(shareKeys.detail(workspaceId, fileId), data.share)
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
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
