import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type BindAppRevisionBody,
  type BuildAppRevisionBody,
  bindAppRevisionContract,
  buildAppRevisionContract,
  type DetachAppRevisionBody,
  deleteAppProjectContract,
  detachAppRevisionContract,
  getAppProjectContract,
  listAppProjectsContract,
  type PrepareAppReleaseBody,
  type PreviewSessionBody,
  type PublishAppReleaseBody,
  prepareAppReleaseContract,
  previewAbortCandidateContract,
  previewPromoteContract,
  previewSessionContract,
  publishAppReleaseContract,
  type RevokeAppReleaseBody,
  type RollbackAppReleaseBody,
  revokeAppReleaseContract,
  rollbackAppReleaseContract,
} from '@/lib/api/contracts/apps'

export const appKeys = {
  all: ['apps'] as const,
  lists: () => [...appKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...appKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...appKeys.all, 'detail'] as const,
  detail: (projectId?: string) => [...appKeys.details(), projectId ?? ''] as const,
}

const APP_LIST_STALE_TIME = 30_000
const APP_DETAIL_STALE_TIME = 10_000

export function useAppProjects(workspaceId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: appKeys.list(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(listAppProjectsContract, {
        query: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: Boolean(workspaceId) && options?.enabled !== false,
    staleTime: APP_LIST_STALE_TIME,
  })
}

export function useAppProject(projectId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: appKeys.detail(projectId),
    queryFn: ({ signal }) =>
      requestJson(getAppProjectContract, {
        params: { projectId: projectId! },
        signal,
      }),
    enabled: Boolean(projectId) && options?.enabled !== false,
    staleTime: APP_DETAIL_STALE_TIME,
  })
}

function useInvalidateAppProject() {
  const queryClient = useQueryClient()
  return async (projectId: string, workspaceId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appKeys.detail(projectId) }),
      workspaceId
        ? queryClient.invalidateQueries({ queryKey: appKeys.list(workspaceId) })
        : queryClient.invalidateQueries({ queryKey: appKeys.lists() }),
    ])
  }
}

export function useArchiveAppProject() {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: ({ projectId }: { projectId: string; workspaceId: string }) =>
      requestJson(deleteAppProjectContract, { params: { projectId } }),
    onSuccess: (_data, variables) => invalidate(variables.projectId, variables.workspaceId),
  })
}

export function useBindAppRevision(projectId: string, workspaceId?: string) {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: (body: BindAppRevisionBody) =>
      requestJson(bindAppRevisionContract, { params: { projectId }, body }),
    onSuccess: () => invalidate(projectId, workspaceId),
  })
}

export function useDetachAppRevision(projectId: string, workspaceId?: string) {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: (body: DetachAppRevisionBody) =>
      requestJson(detachAppRevisionContract, { params: { projectId }, body }),
    onSuccess: () => invalidate(projectId, workspaceId),
  })
}

export function useBuildAppRevision(projectId: string, workspaceId?: string) {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: (body: BuildAppRevisionBody) =>
      requestJson(buildAppRevisionContract, { params: { projectId }, body }),
    onSuccess: () => invalidate(projectId, workspaceId),
  })
}

export function usePrepareAppRelease(projectId: string, workspaceId?: string) {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: (body: PrepareAppReleaseBody) =>
      requestJson(prepareAppReleaseContract, { params: { projectId }, body }),
    onSuccess: () => invalidate(projectId, workspaceId),
  })
}

export function usePublishAppRelease(projectId: string, workspaceId?: string) {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: (body: PublishAppReleaseBody) =>
      requestJson(publishAppReleaseContract, { params: { projectId }, body }),
    onSuccess: () => invalidate(projectId, workspaceId),
  })
}

export function useRevokeAppRelease(projectId: string, workspaceId?: string) {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: (body: RevokeAppReleaseBody) =>
      requestJson(revokeAppReleaseContract, { params: { projectId }, body }),
    onSuccess: () => invalidate(projectId, workspaceId),
  })
}

export function useRollbackAppRelease(projectId: string, workspaceId?: string) {
  const invalidate = useInvalidateAppProject()
  return useMutation({
    mutationFn: (body: RollbackAppReleaseBody) =>
      requestJson(rollbackAppReleaseContract, { params: { projectId }, body }),
    onSuccess: () => invalidate(projectId, workspaceId),
  })
}

export function useCreateAppPreviewSession(projectId: string) {
  return useMutation({
    mutationFn: (body: PreviewSessionBody) =>
      requestJson(previewSessionContract, { params: { projectId }, body }),
  })
}

export function usePromoteAppPreviewCandidate(projectId: string) {
  return useMutation({
    mutationFn: (sessionId: string) =>
      requestJson(previewPromoteContract, {
        params: { projectId },
        body: { sessionId },
      }),
  })
}

export function useAbortAppPreviewCandidate(projectId: string) {
  return useMutation({
    mutationFn: (sessionId: string) =>
      requestJson(previewAbortCandidateContract, {
        params: { projectId },
        body: { sessionId },
      }),
  })
}
