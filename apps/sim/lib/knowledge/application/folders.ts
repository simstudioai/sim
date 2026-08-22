import { AuditAction, AuditResourceType } from '@sim/audit'
import type { folder } from '@sim/db/schema'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import {
  createFolderAtPath,
  deleteFolderByPath,
  relocateFolderByPath,
} from '@/lib/folders/orchestration'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import {
  listActiveFolderRows,
  loadActiveFolderPathIndex,
  resolveFolderPathFromIndex,
} from '@/lib/folders/queries'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE } from '@/lib/knowledge/constants'

type KnowledgeFolder = typeof folder.$inferSelect & { path: string }

export interface ListKnowledgeFoldersInput {
  workspaceId: string
  parentPath?: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface CreateKnowledgeFolderInput {
  workspaceId: string
  path: string
  source?: string
}

export interface RelocateKnowledgeFolderInput {
  workspaceId: string
  path: string
  destinationPath: string
  source?: string
}

export interface DeleteKnowledgeFolderInput {
  workspaceId: string
  path: string
  recursive?: boolean
  source?: string
}

function throwFolderFailure(result: { error?: string; errorCode?: OrchestrationErrorCode }): never {
  throw new OrchestrationError(
    result.errorCode ?? 'internal',
    result.error ?? 'Folder operation failed'
  )
}

export const listKnowledgeFolders = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listFolders,
  resolveContext: ({ input }: { input: ListKnowledgeFoldersInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ input, context }) {
    const index = await loadActiveFolderPathIndex(
      context.workspaceId,
      'knowledge_base',
      undefined,
      { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
    )
    const parentId =
      input.parentPath === undefined
        ? undefined
        : resolveFolderPathFromIndex(index, input.parentPath)
    if (input.parentPath !== undefined && parentId === undefined) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }
    const folders = await listActiveFolderRows(context.workspaceId, 'knowledge_base', {
      parentId,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE,
    })
    return {
      folders: folders.map((folder): KnowledgeFolder => {
        const path = index.pathById.get(folder.id)
        if (!path) throw new Error('Folder path index is missing a listed folder')
        return { ...folder, path }
      }),
    }
  },
})

export const createKnowledgeFolder = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createFolder,
  resolveContext: ({ input }: { input: CreateKnowledgeFolderInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }) {
    const result = await createFolderAtPath({
      resourceType: 'knowledge_base',
      workspaceId: context.workspaceId,
      userId: resolveKnowledgeAttributedUserId(principal, context),
      path: input.path,
      effects: false,
      throwInfrastructure: true,
      maxFolderRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.folder) return throwFolderFailure(result)
    return { folder: { ...result.folder, path: result.path ?? input.path } }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.FOLDER_CREATED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.folder.id,
    resourceName: result.folder.name,
    description: `Created knowledge base folder "${result.folder.path}"`,
    metadata: {
      source: input.source,
      path: result.folder.path,
      folderResourceType: 'knowledge_base',
    },
  }),
})

export const relocateKnowledgeFolder = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.relocateFolder,
  resolveContext: ({ input }: { input: RelocateKnowledgeFolderInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }) {
    const result = await relocateFolderByPath({
      resourceType: 'knowledge_base',
      workspaceId: context.workspaceId,
      userId: resolveKnowledgeAttributedUserId(principal, context),
      path: input.path,
      destinationPath: input.destinationPath,
      effects: false,
      throwInfrastructure: true,
      maxFolderRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.folder) return throwFolderFailure(result)
    return { folder: { ...result.folder, path: result.path ?? input.destinationPath } }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.FOLDER_MOVED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.folder.id,
    resourceName: result.folder.name,
    description: `Moved knowledge base folder to "${result.folder.path}"`,
    metadata: {
      source: input.source,
      sourcePath: input.path,
      destinationPath: result.folder.path,
      folderResourceType: 'knowledge_base',
    },
  }),
})

export const deleteKnowledgeFolder = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteFolder,
  resolveContext: ({ input }: { input: DeleteKnowledgeFolderInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }) {
    if (input.path === ROOT_FOLDER_PATH) {
      throw new OrchestrationError('validation', 'Cannot delete the root path')
    }
    const index = await loadActiveFolderPathIndex(
      context.workspaceId,
      'knowledge_base',
      undefined,
      { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
    )
    const folderId = resolveFolderPathFromIndex(index, input.path)
    const folder = typeof folderId === 'string' ? index.rowById.get(folderId) : undefined
    if (!folder) throw new OrchestrationError('not_found', 'Folder not found')
    const result = await deleteFolderByPath({
      resourceType: 'knowledge_base',
      workspaceId: context.workspaceId,
      userId: resolveKnowledgeAttributedUserId(principal, context),
      path: input.path,
      recursive: input.recursive ?? false,
      effects: false,
      throwInfrastructure: true,
      maxFolderRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE,
    })
    if (!result.success || !result.deletedItems) return throwFolderFailure(result)
    return {
      id: folder.id,
      name: folder.name,
      path: input.path,
      deletedItems: result.deletedItems,
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.FOLDER_DELETED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.id,
    resourceName: result.name,
    description: `Deleted knowledge base folder "${result.path}"`,
    metadata: {
      source: input.source,
      path: result.path,
      folderResourceType: 'knowledge_base',
      deletedItems: result.deletedItems,
    },
  }),
})
