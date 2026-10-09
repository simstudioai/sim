import {
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateProjectFileFolderBody,
  createProjectFileFolderContract,
  type ListProjectFileFoldersQuery,
  listProjectFileFoldersContract,
  type UpdateProjectFileFolderBody,
  updateProjectFileFolderContract,
} from '@/lib/api/contracts/project-file-folders'
import {
  type ArchiveProjectFileItemsBody,
  archiveProjectFileItemsContract,
  type MoveProjectFileItemsBody,
  moveProjectFileItemsContract,
  type RenameProjectFileBody,
  renameProjectFileContract,
  restoreProjectFileContract,
  restoreProjectFileFolderContract,
} from '@/lib/api/contracts/project-file-lifecycle'
import {
  type CreateProjectFileBody,
  createProjectFileContract,
  getProjectFileContract,
  type ListProjectFilesQuery,
  type ListProjectFilesResponse,
  listProjectFilesContract,
} from '@/lib/api/contracts/project-files'
import { getWorkspaceProjectContract } from '@/lib/api/contracts/projects'
import { uploadProjectFileSession } from '@/lib/uploads/client/session-upload'
import type { UploadProgressEvent } from '@/lib/uploads/client/types'
import { PROJECT_FILE_STALE_TIME, projectFilesKeys } from '@/hooks/queries/utils/project-file-keys'

export function useWorkspaceProject(workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: projectFilesKeys.workspaceProject(workspaceId),
    queryFn: ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace is required')
      return requestJson(getWorkspaceProjectContract, { params: { workspaceId }, signal })
    },
    enabled: Boolean(workspaceId) && enabled,
    staleTime: PROJECT_FILE_STALE_TIME,
  })
}

export function useProjectFiles(
  projectId: string | undefined,
  filters: Omit<ListProjectFilesQuery, 'cursor'>,
  enabled = true
) {
  return useInfiniteQuery({
    queryKey: projectFilesKeys.list(projectId, filters),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      if (!projectId) throw new Error('Project is required')
      return requestJson(listProjectFilesContract, {
        params: { id: projectId },
        query: { ...filters, cursor: pageParam ?? undefined },
        signal,
      })
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(projectId) && enabled,
    staleTime: PROJECT_FILE_STALE_TIME,
  })
}

/** Loads the complete active hierarchy for resource pickers, including nested files. */
function getProjectFileInventoryQueryOptions(projectId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: projectFilesKeys.inventory(projectId),
    queryFn: async ({ signal }) => {
      if (!projectId) throw new Error('Project is required')
      const items: ListProjectFilesResponse['items'] = []
      let cursor: string | undefined
      do {
        const page = await requestJson(listProjectFilesContract, {
          params: { id: projectId },
          query: {
            scope: 'active',
            recursive: true,
            limit: 100,
            sortBy: 'name',
            sortOrder: 'asc',
            cursor,
          },
          signal,
        })
        items.push(...page.items)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return items
    },
    enabled: Boolean(projectId) && enabled,
    staleTime: PROJECT_FILE_STALE_TIME,
    retry: false,
  })
}

export function useProjectFileInventory(projectId: string | undefined, enabled = true) {
  return useQuery(getProjectFileInventoryQueryOptions(projectId, enabled))
}

export function useProjectFileInventories(projectIds: readonly string[], enabled = true) {
  return useQueries({
    queries: projectIds.map((projectId) => getProjectFileInventoryQueryOptions(projectId, enabled)),
  })
}

export function getProjectFileQueryOptions(projectId?: string, fileId?: string) {
  return queryOptions({
    queryKey: projectFilesKeys.record(projectId, fileId),
    queryFn: ({ signal }) => {
      if (!projectId || !fileId) throw new Error('Project and file are required')
      return requestJson(getProjectFileContract, {
        params: { id: projectId, fileId },
        signal,
      })
    },
    enabled: Boolean(projectId && fileId),
    staleTime: PROJECT_FILE_STALE_TIME,
  })
}

export function useProjectFile(projectId?: string, fileId?: string) {
  return useQuery(getProjectFileQueryOptions(projectId, fileId))
}

export function useProjectFileFolders(
  projectId: string | undefined,
  scope: ListProjectFileFoldersQuery['scope'] = 'active'
) {
  return useQuery({
    queryKey: projectFilesKeys.folders(projectId, scope),
    queryFn: ({ signal }) => {
      if (!projectId) throw new Error('Project is required')
      return requestJson(listProjectFileFoldersContract, {
        params: { id: projectId },
        query: { scope },
        signal,
      })
    },
    enabled: Boolean(projectId),
    staleTime: PROJECT_FILE_STALE_TIME,
  })
}

export function useCreateProjectFile(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProjectFileBody) =>
      requestJson(createProjectFileContract, { params: { id: projectId }, body }),
    onSuccess: (result) => {
      queryClient.setQueryData(projectFilesKeys.record(projectId, result.file.id), result)
      return queryClient.invalidateQueries({ queryKey: projectFilesKeys.projectLists(projectId) })
    },
  })
}

interface UploadProjectFileParams {
  projectId: string
  file: File
  folderId?: string | null
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

export function useUploadProjectFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: UploadProjectFileParams) => ({
      success: true as const,
      file: await uploadProjectFileSession(params),
    }),
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({
        queryKey: projectFilesKeys.projectLists(variables.projectId),
      }),
  })
}

export function useCreateProjectFileFolder(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProjectFileFolderBody) =>
      requestJson(createProjectFileFolderContract, { params: { id: projectId }, body }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectFilesKeys.projectFolders(projectId) }),
        queryClient.invalidateQueries({ queryKey: projectFilesKeys.projectLists(projectId) }),
      ]),
  })
}

export function useUpdateProjectFileFolder(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId, body }: { folderId: string; body: UpdateProjectFileFolderBody }) =>
      requestJson(updateProjectFileFolderContract, {
        params: { id: projectId, folderId },
        body,
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectFilesKeys.projectFolders(projectId) }),
        queryClient.invalidateQueries({ queryKey: projectFilesKeys.projectLists(projectId) }),
        queryClient.invalidateQueries({ queryKey: projectFilesKeys.records(projectId) }),
      ]),
  })
}

export function useRenameProjectFile(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ fileId, name }: RenameProjectFileBody & { fileId: string }) =>
      requestJson(renameProjectFileContract, {
        params: { id: projectId, fileId },
        body: { name },
      }),
    onSuccess: () => invalidateProjectFileItems(queryClient, projectId),
  })
}

export function useMoveProjectFileItems(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: MoveProjectFileItemsBody) =>
      requestJson(moveProjectFileItemsContract, { params: { id: projectId }, body }),
    onSuccess: () => invalidateProjectFileItems(queryClient, projectId),
  })
}

export function useArchiveProjectFileItems(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ArchiveProjectFileItemsBody) =>
      requestJson(archiveProjectFileItemsContract, { params: { id: projectId }, body }),
    onSuccess: () => invalidateProjectFileItems(queryClient, projectId),
  })
}

export function useRestoreProjectFileItems(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (target: { kind: 'file' | 'folder'; id: string }) =>
      target.kind === 'file'
        ? requestJson(restoreProjectFileContract, {
            params: { id: projectId, fileId: target.id },
            body: {},
          })
        : requestJson(restoreProjectFileFolderContract, {
            params: { id: projectId, folderId: target.id },
            body: {},
          }),
    onSuccess: () => invalidateProjectFileItems(queryClient, projectId),
  })
}

function invalidateProjectFileItems(queryClient: QueryClient, projectId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: projectFilesKeys.projectLists(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectFilesKeys.projectFolders(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectFilesKeys.records(projectId) }),
  ])
}
