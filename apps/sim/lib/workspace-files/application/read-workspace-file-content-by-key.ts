import type { Principal } from '@sim/auth/principal'
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
import { assertOwnedFileAccess } from '@/lib/workspace-files/application/workspace-file-context'
import { OWNED_FILE_CONTEXTS, ownedFileKind } from '@/lib/workspace-files/owned-files'

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
    includeOwnedFiles: true,
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

/** Workspace files and owned files share the `workspace/` key prefix; the row says which. */
const KEY_READABLE_CONTEXTS = new Set<string>(['workspace', ...OWNED_FILE_CONTEXTS])

async function resolveWorkspaceFileByKeyContext({
  principal,
  input,
}: {
  principal: Principal
  input: ReadWorkspaceFileByKeyInput
}): Promise<ActiveWorkspaceFileContext> {
  const metadata = await getFileMetadataByKey(input.key)
  if (
    !metadata?.workspaceId ||
    !KEY_READABLE_CONTEXTS.has(metadata.context) ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== metadata.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  const canonical = await loadActiveWorkspaceFileContext(
    metadata.id,
    ownedFileKind(metadata.context) ? { includeOwnedFiles: true } : undefined
  )
  if (!canonical || canonical.workspaceId !== metadata.workspaceId) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  await assertOwnedFileAccess(principal, canonical)
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
