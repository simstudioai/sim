import type { QueryClient } from '@tanstack/react-query'
import { listWorkspaceFileFoldersContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  listWorkspaceFilesContract,
  listWorkspaceFilesQuerySchema,
  readWorkspaceFileContract,
} from '@/lib/api/contracts/workspace-files'
import { internalSessionAuth } from '@/lib/api/server/routes'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { internalFilePresenters } from '@/lib/workspace-files/api/internal-presenters'
import {
  presentWorkspaceFileList,
  toWorkspaceFileListInput,
} from '@/lib/workspace-files/api/list-page'
import {
  listAllWorkspaceFiles,
  listWorkspaceFileCollection,
} from '@/lib/workspace-files/application/list-workspace-files'
import { readWorkspaceFileContentRecord } from '@/lib/workspace-files/application/read-workspace-file-record'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { authorizeResourcePrefetch } from '@/app/workspace/[workspaceId]/lib/authorize-resource-prefetch'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
import {
  WORKSPACE_FILE_LIST_STALE_TIME,
  WORKSPACE_FILE_RECORD_STALE_TIME,
  type WorkspaceFileListParams,
  workspaceFileListQuery,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-keys'
import {
  WORKSPACE_FILE_FOLDERS_STALE_TIME,
  workspaceFileFolderKeys,
} from '@/hooks/queries/workspace-file-folders'

/** What the Files route renders: a list of files, or one open file. */
export type FilesBrowserView = { list: WorkspaceFileListParams } | { fileId: string }

/**
 * The first page of the list the browser opens on, read through the same use case, input
 * mapping, and presenter the list route runs — so the seeded page, cursor included, is the page
 * a client fetch of that key would cache, and scrolling on resumes from it.
 */
function prefetchFileListPage(
  queryClient: QueryClient,
  workspaceId: string,
  params: WorkspaceFileListParams
) {
  return queryClient.prefetchInfiniteQuery({
    queryKey: workspaceFilesKeys.list(workspaceId, params),
    queryFn: async () => {
      const principal = await internalSessionAuth.authenticate()
      const input = toWorkspaceFileListInput(
        workspaceId,
        listWorkspaceFilesQuerySchema.parse(workspaceFileListQuery(params, null))
      )
      const result = await listWorkspaceFileCollection.execute({ principal, input })
      const response = listWorkspaceFilesContract.response.schema.parse(
        presentWorkspaceFileList(result, input)
      )
      return { files: response.files, nextCursor: response.nextCursor ?? null }
    },
    initialPageParam: null as string | null,
    staleTime: WORKSPACE_FILE_LIST_STALE_TIME,
  })
}

/** The open file's record, through the record route's use case and presenter. */
function prefetchFileRecord(queryClient: QueryClient, workspaceId: string, fileId: string) {
  return queryClient.prefetchQuery({
    queryKey: workspaceFilesKeys.record(workspaceId, fileId),
    queryFn: async () => {
      const principal = await internalSessionAuth.authenticate()
      const result = await readWorkspaceFileContentRecord.execute({
        principal,
        input: { fileId, assertedWorkspaceId: workspaceId },
      })
      return readWorkspaceFileContract.response.schema.parse(
        internalFilePresenters.successFile(result)
      ).file
    },
    staleTime: WORKSPACE_FILE_RECORD_STALE_TIME,
  })
}

/**
 * Prefetches what the Files browser needs on top of the workspace layout's own prefetch, so the
 * first frame is complete and correctly ordered: file folders, and (via
 * {@link prefetchResourceListChrome}) the pinned ids that drive row order plus the members behind
 * the Owner column — under the same query keys their client hooks use (scope `active`) — and
 * either the first page of the list the URL opens on or the open file's record. The record is
 * what decides whether `Files` renders the list or the file, so with it seeded the server and the
 * client render read the same cache and pick the same branch.
 *
 * Folders and the chrome reads go through the data layer, shaped to their route contracts so a
 * hydrated entry matches a client fetch; the files go through their routes' own use cases. A
 * failed file read seeds nothing — only a settled query is dehydrated — and the client fetch
 * reaches the route instead.
 *
 * The data-layer reads carry no authorization of their own, so the viewer is proved first. This
 * reuses the layout's `cache`d host-context lookup rather than re-deriving the permission, so it
 * costs no additional queries; a viewer without access caches nothing and the client fetch
 * reaches the route for the real 403.
 */
export async function prefetchFilesBrowser(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined,
  view: FilesBrowserView
): Promise<void> {
  if (!userId) return
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) return
  if (!(await authorizeResourcePrefetch(listAllWorkspaceFiles, workspaceId))) return

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: workspaceFileFolderKeys.list(workspaceId, 'active'),
      /**
       * Parsed through the route's own response schema rather than seeded raw. The
       * manager's record type and `workspaceFileFolderSchema` are two independent
       * declarations that happen to agree today; without this parse, adding a column
       * to one silently seeds a shape a client fetch would have stripped.
       */
      queryFn: async () => {
        const folders = await listWorkspaceFileFolders(workspaceId, { scope: 'active' })
        return listWorkspaceFileFoldersContract.response.schema.shape.folders.parse(folders)
      },
      staleTime: WORKSPACE_FILE_FOLDERS_STALE_TIME,
    }),
    prefetchResourceListChrome(queryClient, workspaceId, 'file', userId),
    'fileId' in view
      ? prefetchFileRecord(queryClient, workspaceId, view.fileId)
      : prefetchFileListPage(queryClient, workspaceId, view.list),
  ])
}
