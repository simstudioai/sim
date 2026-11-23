import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  type ActiveWorkspaceFileContext,
  ContentVersionConflictError,
  deleteWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import {
  resolveActiveWorkspaceFileContext,
  type WorkspaceFileTargetInput,
} from '@/lib/workspace-files/application/file-context'
import { parseWorkspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const logger = createLogger('DeleteWorkspaceFile')

export interface DeleteWorkspaceFileInput extends WorkspaceFileTargetInput {
  /**
   * Refuse the delete (`conflict`) unless the file still holds exactly this content, as reported
   * by the `revision` an earlier read or write returned.
   */
  expectedRevision?: string
}

export interface DeleteWorkspaceFileResult {
  id: string
  workspaceId: string
  deleted: true
}

async function executeDeleteWorkspaceFile({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.delete,
  DeleteWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<DeleteWorkspaceFileResult> {
  const expectedContentUpdatedAt = input.expectedRevision
    ? parseWorkspaceFileRevision(input.expectedRevision, context.fileId)
    : undefined
  try {
    await deleteWorkspaceFile(context.workspaceId, context.fileId, { expectedContentUpdatedAt })
  } catch (error) {
    if (error instanceof ContentVersionConflictError) {
      throw new OrchestrationError('conflict', error.message)
    }
    throw error
  }
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
