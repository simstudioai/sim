import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import type { folder } from '@sim/db/schema'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { withFolderTreeLock } from '@/lib/folders/locks'
import {
  createFolderAtPathTransition,
  deleteFolderByPathTransition,
  relocateFolderByPathTransition,
} from '@/lib/folders/orchestration'
import type { FolderPathIndex } from '@/lib/folders/paths'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import {
  listActiveFolderRows,
  loadActiveFolderPathIndex,
  resolveFolderPathFromIndex,
} from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'

type WorkflowFolderRecord = typeof folder.$inferSelect
type WorkflowFolderIndex = FolderPathIndex<WorkflowFolderRecord>

export interface ListWorkflowFoldersInput {
  workspaceId: string
  parentPath?: string
  search?: string
  sortBy: 'name' | 'createdAt' | 'updatedAt'
  sortOrder: 'asc' | 'desc'
}

export interface WorkflowFolderResult {
  folder: WorkflowFolderRecord
  index: WorkflowFolderIndex
}

export interface ListWorkflowFoldersResult {
  folders: WorkflowFolderRecord[]
  index: WorkflowFolderIndex
}

export interface CreateWorkflowFolderInput {
  workspaceId: string
  path: string
}

export interface RelocateWorkflowFolderInput {
  workspaceId: string
  path: string
  destinationPath: string
}

export interface DeleteWorkflowFolderInput {
  workspaceId: string
  path: string
  recursive: boolean
}

export interface DeleteWorkflowFolderResult {
  path: string
  folderId: string
  folderName: string
  deletedItems: {
    folders: number
    workflows: number
  }
}

function throwFolderMutationFailure(result: {
  error?: string
  errorCode?: OrchestrationErrorCode
}): never {
  const code = result.errorCode ?? 'internal'
  throw new OrchestrationError(
    code,
    code === 'internal' ? 'Internal server error' : (result.error ?? 'Folder mutation failed')
  )
}

export async function resolveWorkflowFolderPath(
  workspaceId: string,
  path: string
): Promise<{ folderId: string | null; index: WorkflowFolderIndex }> {
  const resolution = await withFolderTreeLock(workspaceId, 'workflow', async (tx) => {
    const index = await loadActiveFolderPathIndex(workspaceId, 'workflow', tx, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const folderId = resolveFolderPathFromIndex(index, path)
    return folderId === undefined
      ? { found: false as const }
      : { found: true as const, folderId, index }
  })
  if (!resolution.found) throw new OrchestrationError('not_found', 'Folder not found')
  return { folderId: resolution.folderId, index: resolution.index }
}

export function workflowFolderPathForId(
  index: WorkflowFolderIndex,
  folderId: string | null | undefined
): string {
  if (!folderId) return ROOT_FOLDER_PATH
  const path = index.pathById.get(folderId)
  if (!path) throw new Error('Workflow references an inactive or missing folder')
  return path
}

export const listWorkflowFolders = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.listFolders,
  resolveContext: ({ input }: { input: ListWorkflowFoldersInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ input, context }): Promise<ListWorkflowFoldersResult> {
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const parentId =
      input.parentPath === undefined
        ? undefined
        : resolveFolderPathFromIndex(index, input.parentPath)
    if (input.parentPath !== undefined && parentId === undefined) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }
    const folders = await listActiveFolderRows(context.workspaceId, 'workflow', {
      parentId,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    return { folders, index }
  },
})

export const createWorkflowFolder = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.createFolder,
  resolveContext: ({ input }: { input: CreateWorkflowFolderInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<WorkflowFolderResult> {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await createFolderAtPathTransition({
      resourceType: 'workflow',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.folder || !result.path) throwFolderMutationFailure(result)
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    return { folder: result.folder, index }
  },
  projectAudit({ input, result }) {
    return {
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Created workflow folder "${input.path}"`,
      metadata: { path: input.path, folderResourceType: 'workflow' },
    }
  },
})

export const relocateWorkflowFolder = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.relocateFolder,
  resolveContext: ({ input }: { input: RelocateWorkflowFolderInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<WorkflowFolderResult> {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await relocateFolderByPathTransition({
      resourceType: 'workflow',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      destinationPath: input.destinationPath,
      maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.folder || !result.path) throwFolderMutationFailure(result)
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    return { folder: result.folder, index }
  },
  projectAudit({ input, result }) {
    return {
      action: AuditAction.FOLDER_MOVED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Moved workflow folder to "${input.destinationPath}"`,
      metadata: {
        sourcePath: input.path,
        destinationPath: input.destinationPath,
        folderResourceType: 'workflow',
      },
    }
  },
})

export const deleteWorkflowFolder = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.deleteFolder,
  resolveContext: ({ input }: { input: DeleteWorkflowFolderInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<DeleteWorkflowFolderResult> {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await deleteFolderByPathTransition({
      resourceType: 'workflow',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      recursive: input.recursive,
      maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    if (
      !result.success ||
      !result.deletedItems ||
      !result.folderId ||
      !result.folderName ||
      !result.path
    ) {
      throwFolderMutationFailure(result)
    }
    return {
      path: result.path,
      folderId: result.folderId,
      folderName: result.folderName,
      deletedItems: {
        folders: result.deletedItems.folders,
        workflows: result.deletedItems.workflows ?? 0,
      },
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folderId,
      resourceName: result.folderName,
      description: `Deleted workflow folder "${result.path}"`,
      metadata: {
        folderResourceType: 'workflow',
        path: result.path,
        affected: {
          workflows: result.deletedItems.workflows,
          subfolders: Math.max(result.deletedItems.folders - 1, 0),
        },
      },
    }
  },
})
