import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import {
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceInlineFileInput {
  workspaceId: string
  key?: string
  fileId?: string
}

export interface ReadWorkspaceInlineFileResult {
  file: WorkspaceFileRecord
  stream: ReadableStream<Uint8Array>
}

async function executeReadWorkspaceInlineFile({
  principal,
  input,
}: {
  principal: Principal
  input: ReadWorkspaceInlineFileInput
}): Promise<ReadWorkspaceInlineFileResult> {
  let fileId = input.fileId
  if (!fileId && input.key) {
    const metadata = await getFileMetadataByKey(input.key, 'workspace')
    if (!metadata || metadata.workspaceId !== input.workspaceId) {
      throw new OrchestrationError('not_found', 'Not found')
    }
    fileId = metadata.id
  }
  if (!fileId) throw new OrchestrationError('validation', 'Provide exactly one file reference')

  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.readContent,
    fileId,
    assertedWorkspaceId: input.workspaceId,
  })
  const file = await getWorkspaceFile(canonical.workspaceId, canonical.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'Not found')

  const stream = await downloadFileStream({ key: file.key, context: 'workspace' })
  return { file, stream: nodeReadableToWebStream(stream) }
}

export const readWorkspaceInlineFile = {
  operation: fileOperations.readContent,
  execute: executeReadWorkspaceInlineFile,
} as const
