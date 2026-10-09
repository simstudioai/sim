import { toast } from '@sim/emcn'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AuthenticatePublicFileResponse,
  authenticatePublicFileContract,
  requestPublicFileOtpContract,
  type UpsertFileShareBody,
  type VerifyPublicFileOtpResponse,
  verifyPublicFileOtpContract,
} from '@/lib/api/contracts/public-shares'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { getFileShareQueryAdapter } from '@/hooks/queries/utils/file-share-query-adapters'

export const FILE_SHARE_STALE_TIME = 30 * 1000

export function useFileShare(
  owner: EditableFileOwner,
  fileId: string,
  options?: { enabled?: boolean }
) {
  const adapter = getFileShareQueryAdapter(owner)
  const query = useQuery({
    queryKey: adapter.key(owner.entityId, fileId),
    queryFn: ({ signal }) => adapter.read(owner.entityId, fileId, signal),
    enabled: Boolean(fileId) && (options?.enabled ?? true),
    staleTime: FILE_SHARE_STALE_TIME,
    refetchOnMount: 'always',
  })
  return { ...query, data: query.data === undefined ? undefined : adapter.state(query.data) }
}

interface UpsertFileShareVariables extends UpsertFileShareBody {
  owner: EditableFileOwner
  fileId: string
}

export function useUpsertFileShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ owner, fileId, ...body }: UpsertFileShareVariables) =>
      getFileShareQueryAdapter(owner).update(owner.entityId, fileId, body),
    onSuccess: (data, { owner, fileId }) => {
      getFileShareQueryAdapter(owner).store(queryClient, owner.entityId, fileId, data.share)
    },
    onError: (error) => {
      toast.error(error.message)
    },
    onSettled: (_data, _error, { owner, fileId }) => {
      getFileShareQueryAdapter(owner).invalidate(queryClient, owner.entityId, fileId)
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
