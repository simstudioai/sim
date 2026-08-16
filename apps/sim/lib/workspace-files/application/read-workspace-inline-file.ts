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
   * Whether the URL that produced this response names the exact storage object it streamed — the only
   * condition under which the bytes may be cached, since a content write never rewrites an object (it
   * uploads under a fresh key and repoints the row).
   *
   * It is deliberately not "the caller passed a key": the key is resolved to a file and the file's
   * CURRENT key is what gets streamed, so a rotation landing between those two reads would serve the
   * new bytes under a URL naming the old object — cached, that would be wrong forever. A `fileId`
   * request names the FILE, whose bytes move as it is edited, and is never content-addressed.
   */
  contentAddressed: boolean
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
    contentAddressed: input.key !== undefined && input.key === file.key,
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
