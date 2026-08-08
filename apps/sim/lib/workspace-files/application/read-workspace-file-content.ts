import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ReadWorkspaceFileContentInput {
  fileId: string
  assertedWorkspaceId?: string
  /** Optional post-authorization storage ceiling for bounded binary reads. */
  maxBytes?: number
  includeDeleted?: boolean
}

export interface ReadWorkspaceFileContentResult {
  file: WorkspaceFileRecord
  content: Buffer
}

async function executeReadWorkspaceFileContent({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileContentInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileContentResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    includeDeleted: input.includeDeleted,
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return {
    file,
    content: await fetchWorkspaceFileBuffer(file, { maxBytes: input.maxBytes }),
  }
}

export const readWorkspaceFileContent = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeReadWorkspaceFileContent,
})
