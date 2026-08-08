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
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
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

async function resolveListWorkspaceFileContext(workspaceId: string) {
  const workspace = await loadActiveWorkspaceContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  return workspace
}

export const listAllWorkspaceFiles = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: ListAllWorkspaceFilesInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    const files = await listWorkspaceFiles(context.workspaceId, { scope: input.scope })
    const shares = await getWorkspaceShares('file', context.workspaceId)
    return {
      files: files.map((file) => ({ ...file, share: shares.get(file.id) ?? null })),
    }
  },
})

export const queryWorkspaceFilePage = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: QueryWorkspaceFilePageInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    const folderIndex = await loadActiveFolderPathIndex(context.workspaceId, 'file')
    const folderId =
      input.folderPath === undefined
        ? undefined
        : input.folderPath === ROOT_FOLDER_PATH
          ? null
          : folderIndex.idByPath.get(input.folderPath)
    if (input.folderPath !== undefined && folderId === undefined) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }

    const { files, nextKeys } = await queryWorkspaceFiles(context.workspaceId, {
      folderId,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit,
      after: input.after,
    })
    return { files, nextKeys, cursorSort: input.cursorSort }
  },
})
