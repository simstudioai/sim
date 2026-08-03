import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { quickBooksDownloadAttachmentContract } from '@/lib/api/contracts/tools/quickbooks'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { buildQuickBooksCompanyUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/client'
import {
  getQuickBooksDocumentError,
  QUICKBOOKS_TEMP_URL_MAX_BYTES,
  sanitizeQuickBooksFileName,
} from '@/tools/quickbooks/documents_utils'

export const dynamic = 'force-dynamic'
const logger = createLogger('QuickBooksDownloadAttachmentAPI')

function contentDispositionFileName(value: string | null): string | undefined {
  if (!value) return undefined
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (utf8) {
    try {
      return decodeURIComponent(utf8)
    } catch {
      return utf8
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1]
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      quickBooksDownloadAttachmentContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { success: false, error: getValidationErrorMessage(error, 'Invalid request') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const { accessToken, realmId, attachmentId, fileName } = parsed.data.body
    const metadataUrl = buildQuickBooksCompanyUrl(
      realmId,
      `download/${encodeURIComponent(attachmentId)}`
    )
    const metadataResponse = await fetch(metadataUrl, {
      method: 'GET',
      headers: { ...buildQuickBooksHeaders(accessToken), Accept: 'text/plain' },
    })
    if (!metadataResponse.ok) throw await getQuickBooksDocumentError(metadataResponse)
    const temporaryUrl = (
      await readResponseTextWithLimit(metadataResponse, {
        maxBytes: QUICKBOOKS_TEMP_URL_MAX_BYTES,
        label: 'QuickBooks temporary attachment URL',
      })
    ).trim()
    if (!temporaryUrl) throw new Error('This QuickBooks attachment has no downloadable file')
    const validation = await validateUrlWithDNS(temporaryUrl, 'QuickBooks attachment URL')
    if (!validation.isValid || !validation.resolvedIP)
      throw new Error(validation.error || 'QuickBooks attachment URL is invalid')

    const downloadResponse = await secureFetchWithPinnedIP(temporaryUrl, validation.resolvedIP, {
      method: 'GET',
      maxResponseBytes: MAX_FILE_SIZE,
      stripAuthOnRedirect: true,
    })
    if (downloadResponse.status === 404) {
      throw new Error('This QuickBooks attachment has no downloadable file')
    }
    if (!downloadResponse.ok)
      throw new Error(`QuickBooks attachment download failed with HTTP ${downloadResponse.status}`)
    assertContentLengthWithinLimit(
      downloadResponse.headers,
      MAX_FILE_SIZE,
      'QuickBooks attachment file'
    )
    const buffer = await readResponseToBufferWithLimit(downloadResponse, {
      maxBytes: MAX_FILE_SIZE,
      label: 'QuickBooks attachment file',
    })
    if (buffer.length === 0) throw new Error('QuickBooks attachment file is empty')
    const mimeType =
      downloadResponse.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ||
      'application/octet-stream'
    let fallbackName = `quickbooks-attachment-${attachmentId}`
    try {
      const urlName = new URL(temporaryUrl).pathname.split('/').pop()
      if (urlName) fallbackName = decodeURIComponent(urlName)
    } catch {
      // The URL was already validated; keep the deterministic fallback.
    }
    const resolvedName = sanitizeQuickBooksFileName(
      fileName ?? undefined,
      contentDispositionFileName(downloadResponse.headers.get('content-disposition')) ||
        fallbackName
    )
    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        attachmentId,
        fileName: resolvedName,
        mimeType,
        size: buffer.length,
      },
    })
  } catch (error) {
    logger.error('QuickBooks attachment download failed', { error: getErrorMessage(error) })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to download QuickBooks attachment') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
