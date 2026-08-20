import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  permanentlyDeleteWorkspaceFile,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileLifecycleContext } from '@/lib/workspace-files/application/workspace-file-context'

const logger = createLogger('PermanentlyDeleteWorkspaceFile')

export interface PermanentlyDeleteWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface PermanentlyDeleteWorkspaceFileResult {
  id: string
  workspaceId: string
  name: string
  deleted: true
  /**
   * Whether the stored bytes were removed along with the row. `false` means the
   * object outlived its row and is now an orphan awaiting the storage sweep —
   * reported rather than hidden, because the file is genuinely gone from the
   * caller's point of view while the bytes have not yet been reclaimed.
   */
  objectDeleted: boolean
}

async function executePermanentlyDeleteWorkspaceFile({
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.deletePermanent,
  PermanentlyDeleteWorkspaceFileInput,
  WorkspaceFileLifecycleContext
>): Promise<PermanentlyDeleteWorkspaceFileResult> {
  /**
   * Checked here as well as in the repository primitive so the precondition is
   * enforced against the canonical record this operation authorized, not only
   * against the row the primitive happens to re-read.
   */
  if (!context.deletedAt) {
    throw new OrchestrationError(
      'conflict',
      `File is not archived. Archive it first with DELETE /api/v2/files/${context.fileId}`
    )
  }

  const { file, objectDeleted } = await permanentlyDeleteWorkspaceFile(
    context.workspaceId,
    context.fileId
  )

  return {
    id: context.fileId,
    workspaceId: context.workspaceId,
    name: file.name,
    deleted: true,
    objectDeleted,
  }
}

/**
 * Irreversibly destroys an archived file.
 *
 * A deliberate two-step: `DELETE /api/v2/files/{fileId}` archives, and only an
 * already-archived file can be destroyed, so no single request can turn a live
 * file into lost bytes.
 */
export const permanentlyDeleteWorkspaceFileOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.deletePermanent,
  resolveContext: ({ input }) => resolveWorkspaceFileLifecycleContext(input),
  execute: executePermanentlyDeleteWorkspaceFile,
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_PERMANENTLY_DELETED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Permanently deleted workspace file "${result.name}"`,
    metadata: { fileId: result.id, objectDeleted: result.objectDeleted },
  }),
  async afterSuccess({ principal, result }) {
    await notifyWorkspaceFilesChanged(result.workspaceId)
    logger.info('Permanently deleted workspace file', {
      workspaceId: result.workspaceId,
      fileId: result.id,
      objectDeleted: result.objectDeleted,
      principalKind: principal.kind,
    })
  },
})
