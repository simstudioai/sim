import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import type { V2SortOrder } from '@/lib/api/contracts/v2/shared'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createFolderAtPath,
  deleteFolderByPath,
  relocateFolderByPath,
} from '@/lib/folders/orchestration'
import {
  type FolderSortBy,
  listActiveFolderRows,
  loadActiveFolderPathIndex,
  resolveFolderPathFromIndex,
} from '@/lib/folders/queries'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveTableWorkspaceContext } from '@/lib/table/application/context'
import { throwTableOperationFailure } from '@/lib/table/application/errors'
import { tableOperations } from '@/lib/table/application/operations'

export interface ListTableFoldersInput {
  workspaceId: string
  parentPath?: string
  search?: string
  sortBy?: Exclude<FolderSortBy, 'position'>
  sortOrder?: V2SortOrder
}

export const listTableFoldersUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.listFolders,
  resolveContext: ({ input }: { input: ListTableFoldersInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table')
    const parentId =
      input.parentPath === undefined
        ? undefined
        : resolveFolderPathFromIndex(index, input.parentPath)
    if (input.parentPath !== undefined && parentId === undefined) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }
    const folders = await listActiveFolderRows(context.workspaceId, 'table', {
      parentId,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    })
    return { folders, index }
  },
})

export interface CreateTableFolderInput {
  workspaceId: string
  path: string
}

export const createTableFolderUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.createFolder,
  resolveContext: ({ input }: { input: CreateTableFolderInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await createFolderAtPath({
      resourceType: 'table',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      recordAudit: false,
    })
    if (!result.success || !result.folder) {
      throwTableOperationFailure(result, 'Failed to create folder')
    }
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table')
    return { folder: result.folder, index, path: input.path }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Created table folder "${result.path}"`,
      metadata: { path: result.path, folderResourceType: 'table' },
    }
  },
})

export interface UpdateTableFolderInput extends CreateTableFolderInput {
  destinationPath: string
}

export const updateTableFolderUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.updateFolder,
  resolveContext: ({ input }: { input: UpdateTableFolderInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await relocateFolderByPath({
      resourceType: 'table',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      destinationPath: input.destinationPath,
      recordAudit: false,
    })
    if (!result.success || !result.folder) {
      throwTableOperationFailure(result, 'Failed to move folder')
    }
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table')
    return { folder: result.folder, index, path: input.destinationPath, sourcePath: input.path }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_MOVED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Moved table folder to "${result.path}"`,
      metadata: {
        sourcePath: result.sourcePath,
        destinationPath: result.path,
        folderResourceType: 'table',
      },
    }
  },
})

export interface DeleteTableFolderInput extends CreateTableFolderInput {
  recursive: boolean
}

export const deleteTableFolderUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteFolder,
  resolveContext: ({ input }: { input: DeleteTableFolderInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await deleteFolderByPath({
      resourceType: 'table',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      recursive: input.recursive,
      recordAudit: false,
    })
    if (!result.success || !result.deletedItems || !result.deletedFolder) {
      throwTableOperationFailure(result, 'Failed to delete folder')
    }
    return {
      path: input.path,
      deleted: true as const,
      deletedItems: {
        folders: result.deletedItems.folders,
        tables: result.deletedItems.tables ?? 0,
      },
      folder: result.deletedFolder,
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Deleted table folder "${result.path}"`,
      metadata: {
        folderResourceType: 'table',
        path: result.path,
        affected: {
          tables: result.deletedItems.tables,
          subfolders: Math.max(result.deletedItems.folders - 1, 0),
        },
      },
    }
  },
})
