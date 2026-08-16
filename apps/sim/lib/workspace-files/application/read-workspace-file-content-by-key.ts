import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  loadActiveWorkspaceFileContext,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileContentByKeyInput {
  key: string
  assertedWorkspaceId?: string
}

export interface ReadWorkspaceFileContentByKeyResult {
  file: WorkspaceFileRecord
  content: Buffer
}

async function executeReadWorkspaceFileContentByKey({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileContentByKeyInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileContentByKeyResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file || file.key !== input.key) throw new OrchestrationError('not_found', 'File not found')
  return { file, content: await fetchWorkspaceFileBuffer(file) }
}

export const readWorkspaceFileContentByKey = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  async resolveContext({ input }) {
    const metadata = await getFileMetadataByKey(input.key, 'workspace')
    if (
      !metadata?.workspaceId ||
      (input.assertedWorkspaceId !== undefined &&
        input.assertedWorkspaceId !== metadata.workspaceId)
    ) {
      throw new OrchestrationError('not_found', 'File not found')
    }
    const canonical = await loadActiveWorkspaceFileContext(metadata.id)
    if (!canonical || canonical.workspaceId !== metadata.workspaceId) {
      throw new OrchestrationError('not_found', 'File not found')
    }
    return canonical
  },
  execute: executeReadWorkspaceFileContentByKey,
})
