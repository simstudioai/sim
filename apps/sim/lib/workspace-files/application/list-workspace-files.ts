import type { Principal } from '@sim/auth/principal'
import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { getWorkspaceShares } from '@/lib/public-shares/share-manager'
import {
  listWorkspaceFiles,
  loadActiveWorkspaceContext,
  queryWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace'
import { authorizeWorkspaceOperation } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ListAllWorkspaceFilesInput {
  workspaceId: string
  scope: 'active' | 'archived' | 'all'
}

export interface QueryWorkspaceFilePageInput {
  workspaceId: string
  folderPath?: string
  search?: string
  sortBy: 'name' | 'size' | 'uploadedAt' | 'updatedAt'
  sortOrder: 'asc' | 'desc'
  limit: number
  after?: CursorKey[]
  cursorSort: string
}

async function requireListWorkspaceFileAccess(principal: Principal, workspaceId: string) {
  const workspace = await loadActiveWorkspaceContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  await authorizeWorkspaceOperation(principal, fileOperations.list, workspace)
  return workspace
}

async function executeListAllWorkspaceFiles({
  principal,
  input,
}: {
  principal: Principal
  input: ListAllWorkspaceFilesInput
}) {
  const workspace = await requireListWorkspaceFileAccess(principal, input.workspaceId)
  const files = await listWorkspaceFiles(workspace.workspaceId, { scope: input.scope })
  const shares = await getWorkspaceShares('file', workspace.workspaceId)
  return {
    files: files.map((file) => ({ ...file, share: shares.get(file.id) ?? null })),
  }
}

async function executeQueryWorkspaceFilePage({
  principal,
  input,
}: {
  principal: Principal
  input: QueryWorkspaceFilePageInput
}) {
  const workspace = await requireListWorkspaceFileAccess(principal, input.workspaceId)
  const folderIndex = await loadActiveFolderPathIndex(workspace.workspaceId, 'file')
  const folderId =
    input.folderPath === undefined
      ? undefined
      : input.folderPath === ROOT_FOLDER_PATH
        ? null
        : folderIndex.idByPath.get(input.folderPath)
  if (input.folderPath !== undefined && folderId === undefined) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }

  const { files, nextKeys } = await queryWorkspaceFiles(workspace.workspaceId, {
    folderId,
    search: input.search,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    limit: input.limit,
    after: input.after,
  })
  return { files, nextKeys, cursorSort: input.cursorSort }
}

export const listAllWorkspaceFiles = {
  operation: fileOperations.list,
  execute: executeListAllWorkspaceFiles,
} as const

export const queryWorkspaceFilePage = {
  operation: fileOperations.list,
  execute: executeQueryWorkspaceFilePage,
} as const
