import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('PhotonImessageToolAPI')

export interface PhotonRouteContext {
  requestId: string
  userId: string | undefined
}

/** Attachments ride the gRPC stream; cap uploads the same way Linq caps its pre-upload. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function fileTooLargeError(sizeBytes: number): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: `File exceeds the 100MB attachment limit (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB)`,
    },
    { status: 400 }
  )
}

export interface MaterializedFile {
  buffer: Buffer
  fileName: string
  mimeType: string
}

interface FileBody {
  file?: unknown
  fileContent?: string | null
  filename?: string | null
  contentType?: string | null
}

/**
 * Resolve an executor file reference (or legacy base64 content) into bytes, enforcing the
 * per-user file ACL. Returns a NextResponse for every failure so routes can pass it straight
 * through.
 */
export async function materializePhotonFile(
  body: FileBody,
  ctx: PhotonRouteContext
): Promise<MaterializedFile | NextResponse> {
  const { file, fileContent, filename, contentType } = body
  let buffer: Buffer
  let resolvedFilename = filename ?? ''
  let resolvedContentType = contentType ?? ''

  if (file) {
    const userFiles = processFilesToUserFiles([file as RawFileInput], ctx.requestId, logger)
    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid file provided' }, { status: 400 })
    }
    const userFile = userFiles[0]
    // File ACLs are per-user; without an authenticated user there is nothing to authorize against.
    if (!ctx.userId) {
      return NextResponse.json(
        { success: false, error: 'File uploads require an authenticated user context' },
        { status: 401 }
      )
    }
    const denied = await assertToolFileAccess(userFile.key, ctx.userId, ctx.requestId, logger)
    if (denied) return denied
    try {
      const resolved = await downloadServableFileFromStorage(userFile, ctx.requestId, logger, {
        maxBytes: MAX_UPLOAD_BYTES,
      })
      buffer = resolved.buffer
      if (!resolvedContentType) {
        resolvedContentType = resolved.contentType || userFile.type || 'application/octet-stream'
      }
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      if (isPayloadSizeLimitError(error)) {
        return fileTooLargeError(error.observedBytes ?? userFile.size)
      }
      logger.error(`[${ctx.requestId}] Failed to download Photon media file:`, error)
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
        { status: 500 }
      )
    }
    if (!resolvedFilename) resolvedFilename = userFile.name
  } else if (fileContent) {
    buffer = Buffer.from(fileContent, 'base64')
    if (!resolvedFilename) resolvedFilename = 'file'
    if (!resolvedContentType) resolvedContentType = 'application/octet-stream'
  } else {
    return NextResponse.json({ success: false, error: 'A file is required' }, { status: 400 })
  }

  if (buffer.length === 0) {
    return NextResponse.json({ success: false, error: 'File is empty' }, { status: 400 })
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return fileTooLargeError(buffer.length)
  }

  return { buffer, fileName: resolvedFilename, mimeType: resolvedContentType }
}
