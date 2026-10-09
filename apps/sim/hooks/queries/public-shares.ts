import { toast } from '@sim/emcn'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AuthenticatePublicFileResponse,
  authenticatePublicFileContract,
  getFileShareContract,
  getFolderShareContract,
  getPublicFileContract,
  getPublicFolderContract,
  requestPublicFileOtpContract,
  type UpsertFileShareBody,
  upsertFileShareContract,
  upsertFolderShareContract,
  type VerifyPublicFileOtpResponse,
  verifyPublicFileOtpContract,
} from '@/lib/api/contracts/public-shares'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

export const FILE_SHARE_STALE_TIME = 30 * 1000
const PUBLIC_SHARE_STALE_TIME = 0

/**
 * Query key factories for public shares
 */
export const shareKeys = {
  all: ['publicShares'] as const,
  details: () => [...shareKeys.all, 'detail'] as const,
  detail: (workspaceId: string, resourceType: 'file' | 'folder', resourceId: string) =>
    [...shareKeys.details(), workspaceId, resourceType, resourceId] as const,
  publicFolder: (token: string, folderId: string | null, cursor: string | null) =>
    [...shareKeys.all, 'folder', token, folderId, cursor] as const,
  publicFile: (token: string, fileId: string | null) =>
    [...shareKeys.all, 'file', token, fileId] as const,
}

interface SharedResource {
  type: 'file' | 'folder'
  id: string
}

export function useResourceShare(
  workspaceId: string,
  resource: SharedResource,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: shareKeys.detail(workspaceId, resource.type, resource.id),
    queryFn: async ({ signal }) => {
      const data =
        resource.type === 'file'
          ? await requestJson(getFileShareContract, {
              params: { id: workspaceId, fileId: resource.id },
              signal,
            })
          : await requestJson(getFolderShareContract, {
              params: { id: workspaceId, folderId: resource.id },
              signal,
            })
      return data.share
    },
    enabled: Boolean(workspaceId) && Boolean(resource.id) && (options?.enabled ?? true),
    staleTime: FILE_SHARE_STALE_TIME,
    refetchOnMount: 'always',
  })
}

interface UpsertResourceShareVariables extends UpsertFileShareBody {
  workspaceId: string
  resource: SharedResource
}

export function useUpsertResourceShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, resource, ...body }: UpsertResourceShareVariables) =>
      resource.type === 'file'
        ? requestJson(upsertFileShareContract, {
            params: { id: workspaceId, fileId: resource.id },
            body,
          })
        : requestJson(upsertFolderShareContract, {
            params: { id: workspaceId, folderId: resource.id },
            body,
          }),
    onSuccess: (data, { workspaceId, resource }) => {
      queryClient.setQueryData(
        shareKeys.detail(workspaceId, resource.type, resource.id),
        data.share
      )
      if (resource.type === 'file') {
        queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
      } else {
        queryClient.invalidateQueries({ queryKey: folderKeys.list(workspaceId, 'active', 'file') })
      }
    },
    onError: (error) => toast.error(error.message),
  })
}

/** Public listings revalidate on navigation; a revoked capability must never show cached children. */
export function usePublicFolder(
  token: string,
  folderId: string | null,
  cursor: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: shareKeys.publicFolder(token, folderId, cursor),
    queryFn: ({ signal }) =>
      requestJson(getPublicFolderContract, {
        params: { token },
        query: { folderId: folderId ?? undefined, cursor: cursor ?? undefined },
        signal,
      }),
    staleTime: PUBLIC_SHARE_STALE_TIME,
    gcTime: 0,
    retry: false,
    enabled,
  })
}

export function usePublicSharedFile(token: string, fileId: string | null) {
  return useQuery({
    queryKey: shareKeys.publicFile(token, fileId),
    queryFn: ({ signal }) =>
      requestJson(getPublicFileContract, {
        params: { token },
        query: { fileId: fileId ?? undefined },
        signal,
      }),
    enabled: fileId !== null,
    staleTime: PUBLIC_SHARE_STALE_TIME,
    gcTime: 0,
    retry: false,
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
