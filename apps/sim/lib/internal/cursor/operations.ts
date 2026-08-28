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
}

export async function downloadCursorArtifact(
  input: DownloadArtifactParams,
  context: CursorOperationContext
): Promise<{
  success: true
  output: { file: { name: string; mimeType: string; data: string; size: number } }
}> {
  context.signal?.throwIfAborted()
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
  if (!validation.isValid || !validation.resolvedIP) {
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
  const file = {
    name: input.path.split('/').pop() || 'artifact',
    mimeType: downloadResponse.headers.get('content-type') || 'application/octet-stream',
    data: fileBuffer.toString('base64'),
    size: fileBuffer.length,
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
