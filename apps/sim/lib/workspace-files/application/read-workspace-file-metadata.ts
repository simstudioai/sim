import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ReadWorkspaceFileMetadataInput {
  fileId: string
  assertedWorkspaceId?: string
  includeDeleted?: boolean
}

export interface ReadWorkspaceFileMetadataResult {
  file: WorkspaceFileRecord
}

async function executeReadWorkspaceFileMetadata({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readMetadata,
  ReadWorkspaceFileMetadataInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileMetadataResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    includeDeleted: input.includeDeleted,
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { file }
}

export const readWorkspaceFileMetadata = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readMetadata,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeReadWorkspaceFileMetadata,
})
