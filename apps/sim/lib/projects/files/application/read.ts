import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { resolveFolderPathFilter } from '@/lib/folders/queries'
import { resolveFolderScope } from '@/lib/folders/subtree'
import type { ProjectFileTarget } from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  buildWorkspaceFileFolderPathMap,
  listFileFolders,
  loadActiveFileFolderPathIndex,
  mapFileRecord,
  type OwnedFileRecord,
  queryFileRecords,
  resolveFileReference,
  workspaceFileVfsPath,
} from '@/lib/uploads/contexts/workspace'
import { type FileBrowserQuery, queryFileBrowserItems } from '@/lib/workspace-files/browser-query'
import { fileOwnerVfsPath } from '@/lib/workspace-files/owner-paths'

interface ListProjectFilesInput extends ProjectFileTarget {
  scope?: 'active' | 'archived'
  folderId?: string | null
  folderPath?: string
  recursive?: boolean
  search?: string
  sortBy: 'name' | 'size' | 'uploadedAt' | 'updatedAt'
  sortOrder: 'asc' | 'desc'
  limit: number
  after?: CursorKey[]
}

interface ListProjectFilesResult {
  files: OwnedFileRecord<{ entityType: 'project'; entityId: string }>[]
  nextKeys: CursorKey[] | null
  capabilities: { canRead: true; canWrite: boolean }
}

export const listProjectFiles = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.list,
  ListProjectFilesInput,
  ListProjectFilesResult
>({
  operation: projectFileOperations.list,
  async execute({ input, context, tx }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) {
      throw new OrchestrationError('validation', 'File page limit must be between 1 and 1000')
    }
    if (input.folderPath !== undefined && input.folderId !== undefined) {
      throw new OrchestrationError('validation', 'Specify either folderPath or folderId, not both')
    }
    let folderId: string | null | string[] | undefined = input.folderId
    if (input.folderPath !== undefined) {
      const index = await loadActiveFileFolderPathIndex(context.owner, tx, {
        maxRows: MAX_FOLDERS_PER_WORKSPACE,
      })
      const filter = resolveFolderPathFilter(index, input.folderPath)
      if (filter.kind === 'noMatch') {
        return {
          files: [],
          nextKeys: null,
          capabilities: { canRead: true, canWrite: context.canWrite },
        }
      }
      folderId = resolveFolderScope(index, filter, input.recursive)
    }
    const result = await queryFileRecords(context.owner, { ...input, folderId }, tx)
    return {
      ...result,
      capabilities: { canRead: true as const, canWrite: context.canWrite },
    }
  },
})

export const getProjectFileMetadata = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readMetadata,
  async execute({ context, tx }) {
    const file = context.file
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    const folders = file.folderId ? await listFileFolders(context.owner, { scope: 'all' }, tx) : []
    return {
      file: mapFileRecord(file, context.owner, buildWorkspaceFileFolderPathMap(folders)),
      capabilities: { canRead: true as const, canWrite: context.canWrite },
    }
  },
})

/** Resolves metadata under collection authority before an adapter requests an exact file capability. */
export const resolveProjectFileReference = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.resolveReference,
  ProjectFileTarget & { fileReference: string },
  {
    file: OwnedFileRecord<{ entityType: 'project'; entityId: string }>
    vfsPath: string
    capabilities: { canRead: true; canWrite: boolean }
  }
>({
  operation: projectFileOperations.resolveReference,
  async execute({ input, context, tx }) {
    const file = await resolveFileReference(context.owner, input.fileReference, tx)
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return {
      file,
      vfsPath: fileOwnerVfsPath(context.owner, workspaceFileVfsPath(file)),
      capabilities: { canRead: true as const, canWrite: context.canWrite },
    }
  },
})

/** The browser pages folders and files together without changing the file-only API listing. */
export const listProjectFileItems = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.list,
  ProjectFileTarget & FileBrowserQuery,
  Awaited<ReturnType<typeof queryFileBrowserItems>> & ListProjectFilesResult
>({
  operation: projectFileOperations.list,
  async execute({ input, context, tx }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000)
      throw new OrchestrationError('validation', 'File page limit must be between 1 and 1000')
    const page = await queryFileBrowserItems(context.owner, input, tx)
    const fileIds = page.items.filter((item) => item.kind === 'file').map((item) => item.id)
    const files = fileIds.length
      ? (
          await queryFileRecords(
            context.owner,
            {
              scope: input.scope,
              fileIds,
              sortBy: 'name',
              sortOrder: 'asc',
              limit: fileIds.length,
            },
            tx
          )
        ).files
      : []
    return { ...page, files, capabilities: { canRead: true as const, canWrite: context.canWrite } }
  },
})
