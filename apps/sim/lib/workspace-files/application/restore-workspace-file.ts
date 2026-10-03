import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  getWorkspaceFile,
  restoreWorkspaceFile,
  type WorkspaceFileLifecycleContext,
  type WorkspaceFileRecord,
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
  /**
   * The file as it exists after the restore. Restore is not a pure undo — it
   * re-roots the file when its folder has been archived and renames it to avoid
   * colliding with whatever took its name — so the caller needs the post-restore
   * record rather than the one it deleted.
   */
  file: WorkspaceFileRecord
}

async function executeRestoreWorkspaceFile({
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.restore,
  RestoreWorkspaceFileInput,
  WorkspaceFileLifecycleContext
>): Promise<RestoreWorkspaceFileResult> {
  await restoreWorkspaceFile(context.workspaceId, context.fileId)
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { restored: true, file }
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
