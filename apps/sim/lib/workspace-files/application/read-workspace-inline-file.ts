import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
  loadActiveWorkspaceFileContext,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceInlineFileInput {
  workspaceId: string
  key?: string
  fileId?: string
}

export interface ReadWorkspaceInlineFileResult {
  file: WorkspaceFileRecord
  stream: ReadableStream<Uint8Array>
  /**
   * How the caller addressed the file, which decides whether the response may be cached.
   *
   * `key` names a storage object, and a content write never rewrites one — it uploads under a fresh
   * key and repoints the row, so the lookup that resolved this request (an exact match on the CURRENT
   * key) either found bytes that can never change or found nothing at all. The response is therefore
   * immutable. `fileId` names the FILE, whose bytes move as it is edited, so those responses must keep
   * revalidating.
   */
  addressedBy: 'key' | 'fileId'
}

async function executeReadWorkspaceInlineFile({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceInlineFileInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceInlineFileResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'Not found')

  const stream = await downloadFileStream({ key: file.key, context: 'workspace' })
  return {
    file,
    stream: nodeReadableToWebStream(stream),
    addressedBy: input.key ? 'key' : 'fileId',
  }
}

export const readWorkspaceInlineFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  async resolveContext({ input }) {
    let fileId = input.fileId
    if (!fileId && input.key) {
      const metadata = await getFileMetadataByKey(input.key, 'workspace')
      if (!metadata || metadata.workspaceId !== input.workspaceId) {
        throw new OrchestrationError('not_found', 'Not found')
      }
      fileId = metadata.id
    }
    if (!fileId) throw new OrchestrationError('validation', 'Provide exactly one file reference')

    const canonical = await loadActiveWorkspaceFileContext(fileId)
    if (!canonical || canonical.workspaceId !== input.workspaceId) {
      throw new OrchestrationError('not_found', 'Not found')
    }
    return canonical
  },
  execute: executeReadWorkspaceInlineFile,
})
