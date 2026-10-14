import type { Principal } from '@sim/auth/principal'
import type { AuthorizedWorkspaceUseCaseContext, WorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { requireAdmittedWorkspaceFile } from '@/lib/workspace-files/application/admit-file-content'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/file-context'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileRecordInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface ReadWorkspaceFileRecordResult {
  file: WorkspaceFileRecord
}

/**
 * Record reads by id admit chat uploads. Listings never surface chat uploads and writes never
 * resolve them.
 */
function createReadWorkspaceFileRecord<const O extends WorkspaceOperation>(operation: O) {
  return defineAuthorizedWorkspaceFileUseCase({
    operation,
    resolveContext: ({
      principal,
      input,
    }: {
      principal: Principal
      input: ReadWorkspaceFileRecordInput
    }) =>
      resolveActiveWorkspaceFileContext({
        ...input,
        includeChatUploads: true,
        ownedFilePrincipal: principal,
      }),
    async execute({
      context,
      principal,
    }: AuthorizedWorkspaceUseCaseContext<
      O,
      ReadWorkspaceFileRecordInput,
      ActiveWorkspaceFileContext
    >): Promise<ReadWorkspaceFileRecordResult> {
      const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
        throwOnError: true,
        includeChatUploads: true,
        includeOwnedFiles: true,
      })
      if (!file) throw new OrchestrationError('not_found', 'File not found')
      /** Callers read and hand on the record's raw bytes, which no redaction reaches. */
      await requireAdmittedWorkspaceFile(principal, context.workspaceId, file, 'opaque')
      return { file }
    },
  })
}

export const readWorkspaceFileContentRecord = createReadWorkspaceFileRecord(
  fileOperations.readContent
)

export const downloadWorkspaceFileRecord = createReadWorkspaceFileRecord(fileOperations.download)
