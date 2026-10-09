import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { loadWorkspaceFileOperationContext } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { prepareUploadFolders } from '@/lib/workspace-files/upload-folders'

interface PrepareUploadFoldersInput {
  workspaceId: string
  targetFolderId: string | null
  paths: string[][]
}

export const prepareUploadFoldersOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.prepareUploadFolders,
  resolveContext: async ({ input }: { input: PrepareUploadFoldersInput }) => {
    const context = await loadWorkspaceFileOperationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  execute: async ({ input, context, principal }) => ({
    folders: await prepareUploadFolders({
      ...input,
      workspaceId: context.workspaceId,
      userId: resolvePrincipalAttribution(principal).attributedUserId,
    }),
  }),
  projectAudit: ({ result }) =>
    result.folders
      .filter((entry) => entry.path.length === 1)
      .map((entry) => ({
        action: AuditAction.FOLDER_CREATED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: entry.id,
        resourceName: entry.name,
        description: `Created folder tree for upload: "${entry.name}"`,
        metadata: {
          folderCount: result.folders.filter((child) => child.path[0] === entry.path[0]).length,
        },
      })),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
