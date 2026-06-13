import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { vantaDownloadContract } from '@/lib/api/contracts/tools/vanta'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  buildVantaUrl,
  extractVantaError,
  fetchVantaWithAuth,
  getVantaBaseUrl,
  VANTA_READ_SCOPE,
} from '@/tools/vanta/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('VantaDownloadAPI')

const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024

function downloadSizeError(bytes: number): NextResponse {
  const sizeMB = (bytes / (1024 * 1024)).toFixed(2)
  return NextResponse.json(
    { success: false, error: `File size (${sizeMB}MB) exceeds download limit of 100MB` },
    { status: 400 }
  )
}

/**
 * Reads a response body incrementally, aborting as soon as the accumulated
 * size exceeds the limit so oversized files are never fully buffered.
 * Returns null when the limit is exceeded.
 */
async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.length > maxBytes ? null : buffer
  }

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * Extracts the filename from a Content-Disposition header, if present.
 */
function getFileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return null
    }
  }
  const plainMatch = header.match(/filename="?([^";]+)"?/i)
  return plainMatch ? plainMatch[1] : null
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Vanta download attempt`, {
        error: authResult.error || 'Unauthorized',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(vantaDownloadContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const mediaUrl = buildVantaUrl(
      getVantaBaseUrl(params.region),
      `/documents/${encodeURIComponent(params.documentId)}/uploads/${encodeURIComponent(params.uploadedFileId)}/media`
    )

    logger.info(`[${requestId}] Downloading Vanta document file`, {
      documentId: params.documentId,
      uploadedFileId: params.uploadedFileId,
    })

    const response = await fetchVantaWithAuth(
      {
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        region: params.region,
        scope: VANTA_READ_SCOPE,
      },
      (accessToken) =>
        fetch(mediaUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        })
    )

    if (!response.ok) {
      const errorData: unknown = await response.json().catch(() => null)
      const message = extractVantaError(errorData, 'Failed to download Vanta document file')
      logger.error(`[${requestId}] Vanta download failed`, { status: response.status, message })
      return NextResponse.json({ success: false, error: message }, { status: response.status })
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_SIZE_BYTES) {
      return downloadSizeError(contentLength)
    }

    const buffer = await readBodyWithLimit(response, MAX_DOWNLOAD_SIZE_BYTES)
    if (buffer === null) {
      return NextResponse.json(
        { success: false, error: 'File exceeds download limit of 100MB' },
        { status: 400 }
      )
    }

    const mimeType = response.headers.get('content-type') || 'application/octet-stream'
    const name =
      getFileNameFromContentDisposition(response.headers.get('content-disposition')) ||
      `vanta-document-file-${params.uploadedFileId}`

    logger.info(`[${requestId}] Vanta download successful`, { name, size: buffer.length })

    return NextResponse.json({
      success: true,
      output: {
        file: { name, mimeType, data: buffer.toString('base64'), size: buffer.length },
        name,
        mimeType,
        size: buffer.length,
      },
    })
  } catch (error) {
    const message = toError(error).message
    logger.error(`[${requestId}] Vanta download failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
