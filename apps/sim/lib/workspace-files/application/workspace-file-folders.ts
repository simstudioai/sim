import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  assertWorkspaceFileItemsBelongToWorkspace,
  bulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolder,
  createWorkspaceFileFolderAtPath,
  deleteWorkspaceFileFolderByPath,
  listWorkspaceFileFolders,
  relocateWorkspaceFileFolderByPath,
  restoreWorkspaceFileFolder,
  updateWorkspaceFileFolder,
  type WorkspaceFileArchiveResult,
  type WorkspaceFileFolderRecord,
} from '@/lib/uploads/contexts/workspace'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { authorizeWorkspaceFileOperation } from '@/lib/workspace-files/application/workspace-operation-context'

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

async function executeListWorkspaceFileFolders(args: {
  principal: Principal
  input: ListWorkspaceFileFoldersInput
  request?: OrchestrationRequestContext
}): Promise<ListWorkspaceFileFoldersResult> {
  await authorizeWorkspaceFileOperation(
    args.principal,
    fileOperations.listFolders,
    args.input.workspaceId
  )
  let folders = await listWorkspaceFileFolders(args.input.workspaceId, { scope: args.input.scope })
  if (args.input.parentPath !== undefined) {
    const parentPath = args.input.parentPath === '/' ? '' : args.input.parentPath.replace(/^\//, '')
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
  principal: Principal
  input: CreateWorkspaceFileFolderInput
  request?: OrchestrationRequestContext
}): Promise<CreateWorkspaceFileFolderResult> {
  const { context } = await authorizeWorkspaceFileOperation(
    args.principal,
    fileOperations.createFolder,
    args.input.workspaceId
  )
  const attribution = resolvePrincipalAttribution(args.principal, {
    workspaceBillingOwnerUserId: context.billedAccountUserId,
  })
  const auditAttribution = resolvePrincipalAuditAttribution(args.principal)
  const result =
    args.input.path !== undefined
      ? await createWorkspaceFileFolderAtPath({
          workspaceId: context.workspaceId,
          userId: attribution.attributedUserId,
          path: args.input.path,
        })
      : {
          folder: await createWorkspaceFileFolder({
            workspaceId: context.workspaceId,
            userId: attribution.attributedUserId,
            name: args.input.name ?? '',
            parentId: args.input.parentId,
          }),
        }
  const folder = 'path' in result ? { ...result.folder, path: result.path } : result.folder
  recordAudit({
    workspaceId: context.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FOLDER_CREATED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folder.id,
    resourceName: folder.name,
    description: `Created file folder "${folder.name}"`,
    metadata: { operation: fileOperations.createFolder.id, actor: auditAttribution.actor },
    request: args.request,
  })
  await notifyWorkspaceFilesChanged(context.workspaceId)
  return { folder }
}

async function executeUpdateWorkspaceFileFolder(args: {
  principal: Principal
  input: UpdateWorkspaceFileFolderInput
  request?: OrchestrationRequestContext
}): Promise<UpdateWorkspaceFileFolderResult> {
  const { context } = await authorizeWorkspaceFileOperation(
    args.principal,
    fileOperations.updateFolder,
    args.input.workspaceId
  )
  const auditAttribution = resolvePrincipalAuditAttribution(args.principal)
  let folder: WorkspaceFileFolderRecord
  if (args.input.path !== undefined || args.input.destinationPath !== undefined) {
    if (!args.input.path || !args.input.destinationPath) {
      throw new OrchestrationError('validation', 'path and destinationPath are required')
    }
    const result = await relocateWorkspaceFileFolderByPath({
      workspaceId: context.workspaceId,
      path: args.input.path,
      destinationPath: args.input.destinationPath,
    })
    folder = { ...result.folder, path: result.path }
  } else {
    if (!args.input.folderId) throw new OrchestrationError('validation', 'Folder ID is required')
    folder = await updateWorkspaceFileFolder({
      workspaceId: context.workspaceId,
      folderId: args.input.folderId,
      name: args.input.name,
      parentId: args.input.parentId,
      sortOrder: args.input.sortOrder,
    })
  }
  recordAudit({
    workspaceId: context.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: args.input.path !== undefined ? AuditAction.FOLDER_MOVED : AuditAction.FOLDER_UPDATED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folder.id,
    resourceName: folder.name,
    description: `Updated file folder "${folder.name}"`,
    metadata: { operation: fileOperations.updateFolder.id, actor: auditAttribution.actor },
    request: args.request,
  })
  await notifyWorkspaceFilesChanged(context.workspaceId)
  logger.info('Updated workspace file folder', {
    workspaceId: context.workspaceId,
    folderId: folder.id,
  })
  return { folder }
}

async function executeDeleteWorkspaceFileFolder(args: {
  principal: Principal
  input: DeleteWorkspaceFileFolderInput
  request?: OrchestrationRequestContext
}): Promise<DeleteWorkspaceFileFolderResult> {
  const { context } = await authorizeWorkspaceFileOperation(
    args.principal,
    fileOperations.deleteFolder,
    args.input.workspaceId
  )
  const auditAttribution = resolvePrincipalAuditAttribution(args.principal)
  let deletedItems: WorkspaceFileArchiveResult
  if (args.input.path !== undefined) {
    deletedItems = await deleteWorkspaceFileFolderByPath({
      workspaceId: context.workspaceId,
      path: args.input.path,
      recursive: args.input.recursive ?? false,
    })
  } else {
    if (!args.input.folderId) throw new OrchestrationError('validation', 'Folder ID is required')
    await assertWorkspaceFileItemsBelongToWorkspace({
      workspaceId: context.workspaceId,
      folderIds: [args.input.folderId],
    })
    deletedItems = await bulkArchiveWorkspaceFileItems({
      workspaceId: context.workspaceId,
      folderIds: [args.input.folderId],
    })
  }
  recordAudit({
    workspaceId: context.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FOLDER_DELETED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: args.input.folderId,
    description: 'Deleted file folder',
    metadata: {
      operation: fileOperations.deleteFolder.id,
      actor: auditAttribution.actor,
      path: args.input.path,
      deletedItems,
    },
    request: args.request,
  })
  await notifyWorkspaceFilesChanged(context.workspaceId)
  return { deletedItems, path: args.input.path }
}

async function executeRestoreWorkspaceFileFolder(args: {
  principal: Principal
  input: RestoreWorkspaceFileFolderInput
  request?: OrchestrationRequestContext
}): Promise<RestoreWorkspaceFileFolderResult> {
  const { context } = await authorizeWorkspaceFileOperation(
    args.principal,
    fileOperations.restoreFolder,
    args.input.workspaceId,
    args.input.folderId
  )
  const auditAttribution = resolvePrincipalAuditAttribution(args.principal)
  const result = await restoreWorkspaceFileFolder(context.workspaceId, args.input.folderId)
  recordAudit({
    workspaceId: context.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FOLDER_RESTORED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: args.input.folderId,
    resourceName: result.folder.name,
    description: `Restored file folder "${result.folder.name}"`,
    metadata: {
      operation: fileOperations.restoreFolder.id,
      actor: auditAttribution.actor,
      restoredItems: result.restoredItems,
    },
    request: args.request,
  })
  await notifyWorkspaceFilesChanged(context.workspaceId)
  return result
}

export const listWorkspaceFileFoldersOperation = {
  operation: fileOperations.listFolders,
  execute: executeListWorkspaceFileFolders,
} as const

export const createWorkspaceFileFolderOperation = {
  operation: fileOperations.createFolder,
  execute: executeCreateWorkspaceFileFolder,
} as const

export const updateWorkspaceFileFolderOperation = {
  operation: fileOperations.updateFolder,
  execute: executeUpdateWorkspaceFileFolder,
} as const

export const deleteWorkspaceFileFolderOperation = {
  operation: fileOperations.deleteFolder,
  execute: executeDeleteWorkspaceFileFolder,
} as const

export const restoreWorkspaceFileFolderOperation = {
  operation: fileOperations.restoreFolder,
  execute: executeRestoreWorkspaceFileFolder,
} as const
