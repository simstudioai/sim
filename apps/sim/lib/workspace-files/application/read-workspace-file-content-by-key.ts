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
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileByKeyInput {
  key: string
  assertedWorkspaceId?: string
}

export interface ReadWorkspaceFileContentByKeyResult {
  file: WorkspaceFileRecord
  content: Buffer
}

export interface ReadWorkspaceFileRecordByKeyResult {
  file: WorkspaceFileRecord
}

async function loadCurrentWorkspaceFileByKey(
  input: ReadWorkspaceFileByKeyInput,
  context: ActiveWorkspaceFileContext
): Promise<WorkspaceFileRecord> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file || file.key !== input.key) throw new OrchestrationError('not_found', 'File not found')
  return file
}

async function executeReadWorkspaceFileContentByKey({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileByKeyInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileContentByKeyResult> {
  const file = await loadCurrentWorkspaceFileByKey(input, context)
  return {
    file,
    content: await fetchWorkspaceFileBuffer(file, { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }),
  }
}

async function resolveWorkspaceFileByKeyContext({
  input,
}: {
  input: ReadWorkspaceFileByKeyInput
}): Promise<ActiveWorkspaceFileContext> {
  const metadata = await getFileMetadataByKey(input.key, 'workspace')
  if (
    !metadata?.workspaceId ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== metadata.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  const canonical = await loadActiveWorkspaceFileContext(metadata.id)
  if (!canonical || canonical.workspaceId !== metadata.workspaceId) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return canonical
}

export const readWorkspaceFileRecordByKey = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: resolveWorkspaceFileByKeyContext,
  async execute({ input, context }): Promise<ReadWorkspaceFileRecordByKeyResult> {
    return { file: await loadCurrentWorkspaceFileByKey(input, context) }
  },
})

export const readWorkspaceFileContentByKey = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: resolveWorkspaceFileByKeyContext,
  execute: executeReadWorkspaceFileContentByKey,
})
