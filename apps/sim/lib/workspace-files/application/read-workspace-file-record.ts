import type { AuthorizedWorkspaceUseCaseContext, WorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ReadWorkspaceFileRecordInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface ReadWorkspaceFileRecordResult {
  file: WorkspaceFileRecord
}

/**
 * Record reads by id admit chat uploads: the sandbox mount reloads an `uploads/<name>`
 * upload through here before presigning it. Listings never surface chat uploads and
 * writes never resolve them.
 */
function createReadWorkspaceFileRecord<const O extends WorkspaceOperation>(operation: O) {
  return defineAuthorizedWorkspaceFileUseCase({
    operation,
    resolveContext: ({ input }: { input: ReadWorkspaceFileRecordInput }) =>
      resolveActiveWorkspaceFileContext({ ...input, includeChatUploads: true }),
    async execute({
      context,
    }: AuthorizedWorkspaceUseCaseContext<
      O,
      ReadWorkspaceFileRecordInput,
      ActiveWorkspaceFileContext
    >): Promise<ReadWorkspaceFileRecordResult> {
      const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
        throwOnError: true,
        includeChatUploads: true,
      })
      if (!file) throw new OrchestrationError('not_found', 'File not found')
      return { file }
    },
  })
}

export const readWorkspaceFileContentRecord = createReadWorkspaceFileRecord(
  fileOperations.readContent
)

export const downloadWorkspaceFileRecord = createReadWorkspaceFileRecord(fileOperations.download)
