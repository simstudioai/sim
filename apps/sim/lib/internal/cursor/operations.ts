import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { CursorOperationError } from '@/lib/internal/cursor/errors'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot/copilot-file-manager'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { resolveStoredFileMetadata } from '@/lib/uploads/utils/validation'
import type { UserFile } from '@/executor/types'
import type { DownloadArtifactParams } from '@/tools/cursor/types'

const logger = createLogger('CursorOperations')
const MAX_CURSOR_METADATA_BYTES = 256 * 1024

interface CursorArtifactLocation {
  url?: string
  downloadUrl?: string
  presignedUrl?: string
}

export interface CursorOperationContext {
  requestId: string
  signal?: AbortSignal
  persistFile?: boolean
  userId?: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export async function downloadCursorArtifact(
  input: DownloadArtifactParams,
  context: CursorOperationContext
): Promise<{
  success: true
  output: { file: UserFile | { name: string; mimeType: string; data: string; size: number } }
}> {
  context.signal?.throwIfAborted()
  const executionContext =
    context.workspaceId && context.workflowId && context.executionId
      ? {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        }
      : null
  if (context.persistFile && !executionContext && !context.userId) {
    throw new CursorOperationError('User context is required to store artifacts', 401)
  }
  const authHeader = `Basic ${Buffer.from(`${input.apiKey}:`).toString('base64')}`
  const artifactResponse = await fetch(
    `https://api.cursor.com/v0/agents/${encodeURIComponent(input.agentId)}/artifacts/download?path=${encodeURIComponent(input.path)}`,
    {
      method: 'GET',
      headers: { Authorization: authHeader },
      signal: context.signal,
    }
  )

  if (!artifactResponse.ok) {
    const errorText = await readResponseTextWithLimit(artifactResponse, {
      maxBytes: MAX_CURSOR_METADATA_BYTES,
      label: 'Cursor artifact error response',
      signal: context.signal,
    }).catch(() => '')
    throw new CursorOperationError(
      errorText || `Failed to get artifact URL (${artifactResponse.status})`,
      artifactResponse.status
    )
  }

  const artifactData = await readResponseJsonWithLimit<CursorArtifactLocation>(artifactResponse, {
    maxBytes: MAX_CURSOR_METADATA_BYTES,
    label: 'Cursor artifact metadata response',
    signal: context.signal,
  })
  const downloadUrl = artifactData.url || artifactData.downloadUrl || artifactData.presignedUrl
  if (!downloadUrl) {
    throw new CursorOperationError('No download URL returned for artifact', 400)
  }

  const validation = await validateUrlWithDNS(downloadUrl, 'downloadUrl', 'contentFetch')
  context.signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new CursorOperationError(validation.error || 'Invalid download URL', 400)
  }
  const downloadResponse = await secureFetchWithPinnedIP(downloadUrl, validation.resolvedIP, {
    profile: 'contentFetch',
    signal: context.signal,
  })
  if (!downloadResponse.ok) {
    throw new CursorOperationError(
      `Failed to download artifact content (${downloadResponse.status}: ${downloadResponse.statusText})`,
      downloadResponse.status
    )
  }

  const fileBuffer = Buffer.from(await downloadResponse.arrayBuffer())
  context.signal?.throwIfAborted()
  const fileName = input.path.split('/').pop() || 'artifact'
  const mimeType = downloadResponse.headers.get('content-type') || 'application/octet-stream'
  let file: UserFile | { name: string; mimeType: string; data: string; size: number }
  if (context.persistFile) {
    const metadata = resolveStoredFileMetadata(fileName, mimeType, fileBuffer)
    file = executionContext
      ? await uploadExecutionFile(
          executionContext,
          fileBuffer,
          metadata.fileName,
          metadata.mimeType,
          context.userId
        )
      : await uploadCopilotFile({
          buffer: fileBuffer,
          fileName: metadata.fileName,
          contentType: metadata.mimeType,
          userId: context.userId!,
        })
    context.signal?.throwIfAborted()
  } else {
    // V1 exposes base64 metadata rather than a file-typed output.
    file = {
      name: fileName,
      mimeType,
      data: fileBuffer.toString('base64'),
      size: fileBuffer.length,
    }
  }
  logger.info(`[${context.requestId}] Cursor artifact downloaded`, {
    agentId: input.agentId,
    path: input.path,
    size: file.size,
  })
  return { success: true, output: { file } }
}

export function cursorOperationErrorMessage(error: unknown): string {
  return getErrorMessage(error, 'Unknown error occurred')
}
