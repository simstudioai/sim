import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { parseFolderPath } from '@/lib/folders/paths'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  assertWorkspaceFileItemsBelongToWorkspace,
  bulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolder,
  createWorkspaceFileFolderAtPath,
  deleteWorkspaceFileFolderByPath,
  ensureWorkspaceFileFolderPath,
  listWorkspaceFileFolders,
  loadWorkspaceFileOperationContext,
  relocateWorkspaceFileFolderByPath,
  restoreWorkspaceFileFolder,
  updateWorkspaceFileFolder,
  type WorkspaceFileArchiveResult,
  type WorkspaceFileFolderRecord,
} from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const logger = createLogger('WorkspaceFileFolders')

export interface ListWorkspaceFileFoldersInput {
  workspaceId: string
  scope?: 'active' | 'archived' | 'all'
  parentPath?: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface ListWorkspaceFileFoldersResult {
  folders: WorkspaceFileFolderRecord[]
}

export interface CreateWorkspaceFileFolderInput {
  workspaceId: string
  name?: string
  parentId?: string | null
  path?: string
}

export interface CreateWorkspaceFileFolderResult {
  folder: WorkspaceFileFolderRecord
}

export interface EnsureWorkspaceFileFolderPathInput {
  workspaceId: string
  /** Decoded folder names, outermost first. An empty list resolves to the root. */
  pathSegments: string[]
}

export interface EnsureWorkspaceFileFolderPathResult {
  /** Id of the deepest folder, or `null` when the path resolves to the root. */
  folderId: string | null
  /**
   * Ids this call inserted, outermost-first — never a folder it reused. Callers that
   * materialize a tree use it to unwind exactly their own writes on failure.
   */
  createdFolderIds: string[]
}

export interface UpdateWorkspaceFileFolderInput {
  workspaceId: string
  folderId?: string
  name?: string
  parentId?: string | null
  sortOrder?: number
  path?: string
  destinationPath?: string
}

export interface UpdateWorkspaceFileFolderResult {
  folder: WorkspaceFileFolderRecord
}

export interface DeleteWorkspaceFileFolderInput {
  workspaceId: string
  folderId?: string
  path?: string
  recursive?: boolean
}

export interface DeleteWorkspaceFileFolderResult {
  deletedItems: WorkspaceFileArchiveResult
  path?: string
}

export interface RestoreWorkspaceFileFolderInput {
  workspaceId: string
  folderId: string
}

export interface RestoreWorkspaceFileFolderResult {
  folder: WorkspaceFileFolderRecord
  restoredItems: WorkspaceFileArchiveResult
}

async function resolveFolderContext({ input }: { input: { workspaceId: string } }) {
  const context = await loadWorkspaceFileOperationContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

type FolderOperationContext = Awaited<ReturnType<typeof resolveFolderContext>>

async function executeListWorkspaceFileFolders(args: {
  input: ListWorkspaceFileFoldersInput
  context: FolderOperationContext
}): Promise<ListWorkspaceFileFoldersResult> {
  let folders = await listWorkspaceFileFolders(args.context.workspaceId, {
    scope: args.input.scope,
  })
  if (args.input.parentPath !== undefined) {
    const parentPath = parseFolderPath(args.input.parentPath).join('/')
    folders = folders.filter((folder) => {
      const parent = folder.path.includes('/')
        ? folder.path.slice(0, folder.path.lastIndexOf('/'))
        : ''
      return parent === parentPath
    })
  }
  if (args.input.search) {
    const search = args.input.search.toLowerCase()
    folders = folders.filter((folder) => folder.name.toLowerCase().includes(search))
  }
  const sortBy = args.input.sortBy ?? 'name'
  const sortOrder = args.input.sortOrder ?? 'asc'
  folders.sort((left, right) => {
    const leftValue = left[sortBy]
    const rightValue = right[sortBy]
    const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
    return sortOrder === 'asc' ? comparison : -comparison
  })
  return { folders }
}

async function executeCreateWorkspaceFileFolder(args: {
  principal: Parameters<typeof resolvePrincipalAttribution>[0]
  input: CreateWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<CreateWorkspaceFileFolderResult> {
  const attribution = resolvePrincipalAttribution(args.principal, {
    workspaceBillingOwnerUserId: args.context.billedAccountUserId,
  })
  const result =
    args.input.path !== undefined
      ? await createWorkspaceFileFolderAtPath({
          workspaceId: args.context.workspaceId,
          userId: attribution.attributedUserId,
          path: args.input.path,
        })
      : {
          folder: await createWorkspaceFileFolder({
            workspaceId: args.context.workspaceId,
            userId: attribution.attributedUserId,
            name: args.input.name ?? '',
            parentId: args.input.parentId,
          }),
        }
  const folder = 'path' in result ? { ...result.folder, path: result.path } : result.folder
  return { folder }
}

async function executeEnsureWorkspaceFileFolderPath(args: {
  principal: Parameters<typeof resolvePrincipalAttribution>[0]
  input: EnsureWorkspaceFileFolderPathInput
  context: FolderOperationContext
}): Promise<EnsureWorkspaceFileFolderPathResult> {
  const attribution = resolvePrincipalAttribution(args.principal, {
    workspaceBillingOwnerUserId: args.context.billedAccountUserId,
  })
  return ensureWorkspaceFileFolderPath({
    workspaceId: args.context.workspaceId,
    userId: attribution.attributedUserId,
    pathSegments: args.input.pathSegments,
  })
}

async function executeUpdateWorkspaceFileFolder(args: {
  input: UpdateWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<UpdateWorkspaceFileFolderResult> {
  let folder: WorkspaceFileFolderRecord
  if (args.input.path !== undefined || args.input.destinationPath !== undefined) {
    if (!args.input.path || !args.input.destinationPath) {
      throw new OrchestrationError('validation', 'path and destinationPath are required')
    }
    const result = await relocateWorkspaceFileFolderByPath({
      workspaceId: args.context.workspaceId,
      path: args.input.path,
      destinationPath: args.input.destinationPath,
    })
    folder = { ...result.folder, path: result.path }
  } else {
    if (!args.input.folderId) throw new OrchestrationError('validation', 'Folder ID is required')
    folder = await updateWorkspaceFileFolder({
      workspaceId: args.context.workspaceId,
      folderId: args.input.folderId,
      name: args.input.name,
      parentId: args.input.parentId,
      sortOrder: args.input.sortOrder,
    })
  }
  logger.info('Updated workspace file folder', {
    workspaceId: args.context.workspaceId,
    folderId: folder.id,
  })
  return { folder }
}

async function executeDeleteWorkspaceFileFolder(args: {
  input: DeleteWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<DeleteWorkspaceFileFolderResult> {
  let deletedItems: WorkspaceFileArchiveResult
  if (args.input.path !== undefined) {
    deletedItems = await deleteWorkspaceFileFolderByPath({
      workspaceId: args.context.workspaceId,
      path: args.input.path,
      recursive: args.input.recursive ?? false,
    })
  } else {
    if (!args.input.folderId) throw new OrchestrationError('validation', 'Folder ID is required')
    await assertWorkspaceFileItemsBelongToWorkspace({
      workspaceId: args.context.workspaceId,
      folderIds: [args.input.folderId],
    })
    const archived = await bulkArchiveWorkspaceFileItems({
      workspaceId: args.context.workspaceId,
      folderIds: [args.input.folderId],
    })
    deletedItems = { files: archived.fileIds.length, folders: archived.folderIds.length }
  }
  if (deletedItems.files === 0 && deletedItems.folders === 0) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }
  return { deletedItems, path: args.input.path }
}

async function executeRestoreWorkspaceFileFolder(args: {
  input: RestoreWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<RestoreWorkspaceFileFolderResult> {
  return restoreWorkspaceFileFolder(args.context.workspaceId, args.input.folderId)
}

export const listWorkspaceFileFoldersOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.listFolders,
  resolveContext: (args: { input: ListWorkspaceFileFoldersInput }) => resolveFolderContext(args),
  execute: executeListWorkspaceFileFolders,
})

export const createWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.createFolder,
  resolveContext: (args: { input: CreateWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeCreateWorkspaceFileFolder,
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Created file folder "${result.folder.name}"`,
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

/**
 * Idempotently materializes a whole folder chain, reusing every folder that already
 * exists and creating only the missing ones. Unlike {@link createWorkspaceFileFolderOperation}
 * — which creates exactly one leaf and fails on an existing path or a missing parent —
 * this is the primitive for writers that materialize a tree (archive extraction), where
 * intermediate folders and repeat runs are expected rather than exceptional.
 */
export const ensureWorkspaceFileFolderPathOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.createFolder,
  resolveContext: (args: { input: EnsureWorkspaceFileFolderPathInput }) =>
    resolveFolderContext(args),
  execute: executeEnsureWorkspaceFileFolderPath,
})

export const updateWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateFolder,
  resolveContext: (args: { input: UpdateWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeUpdateWorkspaceFileFolder,
  projectAudit({ input, result }) {
    return {
      action: input.path !== undefined ? AuditAction.FOLDER_MOVED : AuditAction.FOLDER_UPDATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Updated file folder "${result.folder.name}"`,
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

export const deleteWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.deleteFolder,
  resolveContext: (args: { input: DeleteWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeDeleteWorkspaceFileFolder,
  projectAudit({ input, result }) {
    return {
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: input.folderId,
      description: 'Deleted file folder',
      metadata: {
        path: input.path,
        deletedItems: result.deletedItems,
      },
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

export const restoreWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.restoreFolder,
  resolveContext: (args: { input: RestoreWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeRestoreWorkspaceFileFolder,
  projectAudit({ input, result }) {
    return {
      action: AuditAction.FOLDER_RESTORED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: input.folderId,
      resourceName: result.folder.name,
      description: `Restored file folder "${result.folder.name}"`,
      metadata: { restoredItems: result.restoredItems },
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})
