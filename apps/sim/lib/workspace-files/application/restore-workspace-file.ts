import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  restoreWorkspaceFile,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileLifecycleContext } from '@/lib/workspace-files/application/workspace-file-context'

const logger = createLogger('RestoreWorkspaceFile')

export interface RestoreWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface RestoreWorkspaceFileResult {
  restored: true
}

async function executeRestoreWorkspaceFile({
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.restore,
  RestoreWorkspaceFileInput,
  WorkspaceFileLifecycleContext
>): Promise<RestoreWorkspaceFileResult> {
  await restoreWorkspaceFile(context.workspaceId, context.fileId)
  return { restored: true }
}

export const restoreWorkspaceFileOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.restore,
  resolveContext: ({ input }) => resolveWorkspaceFileLifecycleContext(input),
  execute: executeRestoreWorkspaceFile,
  projectAudit: ({ context }) => ({
    action: AuditAction.FILE_RESTORED,
    resourceType: AuditResourceType.FILE,
    resourceId: context.fileId,
    resourceName: context.fileId,
    description: `Restored workspace file ${context.fileId}`,
  }),
  async afterSuccess({ principal, context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
    logger.info('Restored workspace file', {
      workspaceId: context.workspaceId,
      fileId: context.fileId,
      principalKind: principal.kind,
    })
  },
})
