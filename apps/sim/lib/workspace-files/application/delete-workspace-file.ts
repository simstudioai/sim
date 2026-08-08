import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  type ActiveWorkspaceFileContext,
  deleteWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

const logger = createLogger('DeleteWorkspaceFile')

export interface DeleteWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface DeleteWorkspaceFileResult {
  id: string
  workspaceId: string
  deleted: true
}

async function executeDeleteWorkspaceFile({
  principal,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.delete,
  DeleteWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<DeleteWorkspaceFileResult> {
  await deleteWorkspaceFile(context.workspaceId, context.fileId)
  return { id: context.fileId, workspaceId: context.workspaceId, deleted: true }
}

export const deleteWorkspaceFileOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.delete,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeDeleteWorkspaceFile,
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_DELETED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.id,
    description: `Deleted workspace file ${result.id}`,
  }),
  async afterSuccess({ principal, result }) {
    await notifyWorkspaceFilesChanged(result.workspaceId)
    logger.info('Deleted workspace file', {
      workspaceId: result.workspaceId,
      fileId: result.id,
      principalKind: principal.kind,
    })
  },
})
