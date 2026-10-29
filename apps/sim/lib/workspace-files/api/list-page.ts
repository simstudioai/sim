import {
  DEFAULT_WORKSPACE_FILE_PAGE_SIZE,
  type ListWorkspaceFilesQuery,
  listWorkspaceFilesContract,
  WORKSPACE_FILE_PAGE_PARAMS,
} from '@/lib/api/contracts/workspace-files'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import type { CursorKey } from '@/lib/api/list-query'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { internalFilePresenters } from '@/lib/workspace-files/api/internal-presenters'
import type { ListWorkspaceFileCollectionInput } from '@/lib/workspace-files/application/list-workspace-files'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

interface FileCursorScope {
  scope: 'active' | 'archived'
  folderId?: string | null
  recursive?: boolean
  search?: string
  kinds?: readonly string[]
  sizeBuckets?: readonly string[]
  uploadedBy?: readonly string[]
}

/**
 * Every param that changes which files, in which order, a page walk returns. The set filters
 * arrive sorted and de-duplicated from the contract, the one parse both halves share.
 */
function fileCursorFilters(workspaceId: string, query: FileCursorScope) {
  return cursorScopeKey(cursorRoute(listWorkspaceFilesContract, { id: workspaceId }), {
    scope: query.scope,
    folderId: query.folderId,
    recursive: query.folderId === undefined ? undefined : query.recursive,
    q: query.search,
    types: query.kinds,
    sizes: query.sizeBuckets,
    uploadedBy: query.uploadedBy,
  })
}

/**
 * The file collection a `GET /api/workspaces/[id]/files` query asks for: one bounded page when
 * any paging param is sent (resuming from its cursor, which must have been minted under the same
 * scope, folder, search, filters, and sort), else the whole scope.
 */
export function toWorkspaceFileListInput(
  workspaceId: string,
  query: ListWorkspaceFilesQuery
): ListWorkspaceFileCollectionInput {
  if (!WORKSPACE_FILE_PAGE_PARAMS.some((param) => query[param] !== undefined)) {
    return { workspaceId, scope: query.scope }
  }
  const sortBy = query.sortBy ?? 'uploadedAt'
  const sortOrder = query.sortOrder ?? 'asc'
  const filters = {
    folderId: query.folderId,
    recursive: query.recursive,
    search: query.q,
    kinds: query.types,
    sizeBuckets: query.sizes,
    uploadedBy: query.uploadedBy,
  }
  return {
    workspaceId,
    scope: query.scope,
    page: {
      ...filters,
      sortBy,
      sortOrder,
      limit: query.limit ?? DEFAULT_WORKSPACE_FILE_PAGE_SIZE,
      after: readSortedCursor(
        query.cursor,
        sortBy,
        sortOrder,
        fileCursorFilters(workspaceId, { scope: query.scope, ...filters })
      ),
    },
  }
}

/** The list response for {@link toWorkspaceFileListInput}'s input: a paged one carries `nextCursor`. */
export function presentWorkspaceFileList(
  result: { files: WorkspaceFileRecord[]; nextKeys: CursorKey[] | null },
  input: ListWorkspaceFileCollectionInput
) {
  const listed = internalFilePresenters.successFiles(result)
  if (!input.page) return listed
  return {
    ...listed,
    nextCursor: writeSortedCursor(
      result.nextKeys,
      input.page.sortBy,
      input.page.sortOrder,
      fileCursorFilters(input.workspaceId, { scope: input.scope, ...input.page })
    ),
  }
}
