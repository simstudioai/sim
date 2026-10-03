import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import type { ListSortOrder } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import {
  createFolderAtPathTransition,
  deleteFolderByPathTransition,
  relocateFolderByPathTransition,
  restoreFolder,
} from '@/lib/folders/orchestration'
import {
  type FolderSortBy,
  findArchivedFolderIdByPath,
  listActiveFolderRows,
  loadActiveFolderPathIndex,
  resolveFolderPathFilter,
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
  sortOrder?: ListSortOrder
}

export const listTableFoldersUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.listFolders,
  resolveContext: ({ input }: { input: ListTableFoldersInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const parentFilter = resolveFolderPathFilter(index, input.parentPath)
    if (parentFilter.kind === 'noMatch') return { folders: [], index }
    const folders = await listActiveFolderRows(context.workspaceId, 'table', {
      parentId: parentFilter.kind === 'folder' ? parentFilter.folderId : undefined,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
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
    const result = await createFolderAtPathTransition({
      resourceType: 'table',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.folder) {
      throwTableOperationFailure(result, 'Failed to create folder')
    }
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
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
    const result = await relocateFolderByPathTransition({
      resourceType: 'table',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      destinationPath: input.destinationPath,
      maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.folder) {
      throwTableOperationFailure(result, 'Failed to move folder')
    }
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    return {
      folder: result.folder,
      index,
      /** Where the folder landed: the destination itself, or inside it when it already existed. */
      path: result.path ?? input.destinationPath,
      sourcePath: input.path,
    }
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
    const result = await deleteFolderByPathTransition({
      resourceType: 'table',
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      path: input.path,
      recursive: input.recursive,
      maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.deletedItems || !result.folderId || !result.folderName) {
      throwTableOperationFailure(result, 'Failed to delete folder')
    }
    return {
      path: input.path,
      deleted: true as const,
      deletedItems: {
        folders: result.deletedItems.folders,
        tables: result.deletedItems.tables ?? 0,
      },
      folder: { id: result.folderId, name: result.folderName },
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

export interface RestoreTableFolderInput {
  workspaceId: string
  path: string
}

/**
 * Restores a soft-deleted table folder tree.
 *
 * `DELETE /api/v2/tables/folders` archives recursively, so without this a recursive delete
 * was unrecoverable over the API: the archived tables stayed visible through
 * `GET /api/v2/tables?scope=archived`, but nothing could put the folder structure back.
 *
 * The folder is addressed by the path it held when it was deleted. The restore itself may
 * land it somewhere else — a folder whose parent is still archived is re-rooted, and a name
 * an active sibling has taken meanwhile is deduplicated — so the response reports the
 * folder's ACTUAL post-restore path rather than echoing the request.
 */
export const restoreTableFolderUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.restoreFolder,
  resolveContext: ({ input }: { input: RestoreTableFolderInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const folderId = await findArchivedFolderIdByPath(context.workspaceId, 'table', input.path, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    if (!folderId) throw new OrchestrationError('not_found', 'Folder not found')

    const result = await restoreFolder(
      {
        resourceType: 'table',
        workspaceId: context.workspaceId,
        userId: attribution.attributedUserId,
        folderId,
      },
      { projectAudit: false }
    )
    if (!result.success || !result.restoredItems) {
      throwTableOperationFailure(result, 'Failed to restore folder')
    }

    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const folder = index.rowById.get(folderId)
    if (!folder) {
      throw new OrchestrationError('internal', 'Restored folder is missing from the folder tree')
    }
    return {
      folder,
      index,
      requestedPath: input.path,
      restoredItems: {
        folders: result.restoredItems.folders,
        tables: result.restoredItems.tables ?? 0,
      },
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_RESTORED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Restored table folder "${result.requestedPath}"`,
      metadata: {
        folderResourceType: 'table',
        path: result.requestedPath,
        restoredItems: result.restoredItems,
      },
    }
  },
})
