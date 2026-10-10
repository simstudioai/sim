import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import type { DbTransaction } from '@/lib/db/types'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  createFileFolder,
  listFileFolders,
  updateFileFolder,
} from '@/lib/uploads/contexts/workspace'

interface FolderUseCaseArgs<I> {
  principal: Principal
  input: I
  context: ProjectFileAuthorizationContext
  tx: DbTransaction
}

interface ListProjectFileFoldersInput extends ProjectFileTarget {
  scope?: 'active' | 'archived' | 'all'
}

interface CreateProjectFileFolderInput extends ProjectFileTarget {
  name: string
  parentId?: string | null
}

interface UpdateProjectFileFolderInput extends ProjectFileTarget {
  folderId: string
  name?: string
  parentId?: string | null
  sortOrder?: number
}

export const listProjectFileFolders = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.listFolders,
  async execute({ input, context, tx }: FolderUseCaseArgs<ListProjectFileFoldersInput>) {
    return {
      folders: await listFileFolders(context.owner, { scope: input.scope }, tx),
      capabilities: { canRead: true as const, canWrite: context.canWrite },
    }
  },
})

export const createProjectFileFolder = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.createFolder,
  invalidatesFileList: true,
  async execute({
    principal,
    input,
    context,
    tx,
  }: FolderUseCaseArgs<CreateProjectFileFolderInput>) {
    return {
      folder: await createFileFolder(
        {
          owner: context.owner,
          userId: requirePrincipalSubjectUserId(principal),
          name: input.name,
          parentId: input.parentId,
        },
        tx
      ),
    }
  },
  projectAudit({ input, result }) {
    return {
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Created Project file folder "${result.folder.name}"`,
      metadata: { projectId: input.projectId },
    }
  },
})

export const updateProjectFileFolder = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.updateFolder,
  invalidatesFileList: true,
  async execute({ input, context, tx }: FolderUseCaseArgs<UpdateProjectFileFolderInput>) {
    return {
      folder: await updateFileFolder(
        {
          owner: context.owner,
          folderId: input.folderId,
          name: input.name,
          parentId: input.parentId,
          sortOrder: input.sortOrder,
        },
        tx
      ),
    }
  },
  projectAudit({ input, result }) {
    return {
      action: input.parentId === undefined ? AuditAction.FOLDER_UPDATED : AuditAction.FOLDER_MOVED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Updated Project file folder "${result.folder.name}"`,
      metadata: { projectId: input.projectId },
    }
  },
})
