import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  type ActiveWorkspaceFileContext,
  renameWorkspaceFile as renameStoredWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

const logger = createLogger('RenameWorkspaceFile')

export interface RenameWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
  name: string
}

export interface RenameWorkspaceFileResult {
  file: WorkspaceFileRecord
}

async function executeRenameWorkspaceFile({
  principal,
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.rename,
  RenameWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<RenameWorkspaceFileResult> {
  const file = await renameStoredWorkspaceFile(context.workspaceId, context.fileId, input.name)

  logger.info('Renamed workspace file', {
    workspaceId: context.workspaceId,
    fileId: context.fileId,
    name: file.name,
    principalKind: principal.kind,
  })
  return { file }
}

export const renameWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.rename,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeRenameWorkspaceFile,
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Renamed file to "${result.file.name}"`,
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
