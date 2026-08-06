import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import {
  type QuickBooksDownloadDocumentBody,
  quickBooksDownloadDocumentContract,
} from '@/lib/api/contracts/tools/quickbooks'
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
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { buildQuickBooksCompanyUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/client'
import {
  getQuickBooksDocumentError,
  getQuickBooksDocumentTransaction,
  QUICKBOOKS_DOCUMENT_METADATA_TIMEOUT_MS,
  QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS,
  QUICKBOOKS_MAX_ATTACHMENT_BYTES,
  QUICKBOOKS_TEMP_URL_MAX_BYTES,
  quickBooksDocumentSignal,
  sanitizeQuickBooksFileName,
} from '@/tools/quickbooks/documents_utils'

export const dynamic = 'force-dynamic'
const logger = createLogger('QuickBooksDownloadDocumentAPI')

interface DownloadedDocument {
  buffer: Buffer
  mimeType: string
  fileName: string
}

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

/**
 * Resolves the short-lived Intuit URL for an attachment, then reads the file
 * through the SSRF-guarded pinned-IP client.
 */
async function downloadQuickBooksAttachment(
  body: Extract<QuickBooksDownloadDocumentBody, { documentKind: 'attachment' }>,
  signal: AbortSignal
): Promise<DownloadedDocument> {
  const metadataUrl = buildQuickBooksCompanyUrl(
    body.realmId,
    `download/${encodeURIComponent(body.attachmentId)}`
  )
  const metadataResponse = await fetch(metadataUrl, {
    method: 'GET',
    headers: { ...buildQuickBooksHeaders(body.accessToken), Accept: 'text/plain' },
    signal: quickBooksDocumentSignal(signal, QUICKBOOKS_DOCUMENT_METADATA_TIMEOUT_MS),
  })
  if (!metadataResponse.ok) throw await getQuickBooksDocumentError(metadataResponse, signal)
  const temporaryUrl = (
    await readResponseTextWithLimit(metadataResponse, {
      maxBytes: QUICKBOOKS_TEMP_URL_MAX_BYTES,
      label: 'QuickBooks temporary attachment URL',
      signal,
    })
  ).trim()
  if (!temporaryUrl) throw new Error('This QuickBooks attachment has no downloadable file')
  const validation = await validateUrlWithDNS(temporaryUrl, 'QuickBooks attachment URL')
  if (!validation.isValid || !validation.resolvedIP)
    throw new Error(validation.error || 'QuickBooks attachment URL is invalid')
  signal.throwIfAborted()

  const transferSignal = quickBooksDocumentSignal(signal, QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS)
  const downloadResponse = await secureFetchWithPinnedIP(temporaryUrl, validation.resolvedIP, {
    method: 'GET',
    maxResponseBytes: QUICKBOOKS_MAX_ATTACHMENT_BYTES,
    stripAuthOnRedirect: true,
    timeout: QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS,
    signal: transferSignal,
  })
  if (downloadResponse.status === 404)
    throw new Error('This QuickBooks attachment has no downloadable file')
  if (!downloadResponse.ok)
    throw new Error(`QuickBooks attachment download failed with HTTP ${downloadResponse.status}`)
  assertContentLengthWithinLimit(
    downloadResponse.headers,
    QUICKBOOKS_MAX_ATTACHMENT_BYTES,
    'QuickBooks attachment file'
  )
  const buffer = await readResponseToBufferWithLimit(downloadResponse, {
    maxBytes: QUICKBOOKS_MAX_ATTACHMENT_BYTES,
    label: 'QuickBooks attachment file',
    signal: transferSignal,
  })
  if (buffer.length === 0) throw new Error('QuickBooks attachment file is empty')

  let fallbackName = `quickbooks-attachment-${body.attachmentId}`
  try {
    const urlName = new URL(temporaryUrl).pathname.split('/').pop()
    if (urlName) fallbackName = decodeURIComponent(urlName)
  } catch {
    // The URL was already validated; keep the deterministic fallback.
  }
  return {
    buffer,
    mimeType:
      downloadResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ||
      'application/octet-stream',
    fileName: sanitizeQuickBooksFileName(
      body.fileName ?? undefined,
      contentDispositionFileName(downloadResponse.headers.get('content-disposition')) ||
        fallbackName
    ),
  }
}

/**
 * Renders a supported transaction as a PDF. The filename is resolved and
 * validated first so a bad override fails before any bytes are transferred.
 */
async function downloadQuickBooksTransactionPdf(
  body: Extract<QuickBooksDownloadDocumentBody, { documentKind: 'transaction_pdf' }>,
  signal: AbortSignal
): Promise<DownloadedDocument> {
  const fileName = sanitizeQuickBooksFileName(
    body.fileName ?? undefined,
    `quickbooks-${body.transactionType.replaceAll('_', '-')}-${body.transactionId}.pdf`
  )
  if (!fileName.toLowerCase().endsWith('.pdf')) throw new Error('PDF filename must end in .pdf')

  const { resource } = getQuickBooksDocumentTransaction(body.transactionType)
  const url = buildQuickBooksCompanyUrl(
    body.realmId,
    `${resource}/${encodeURIComponent(body.transactionId)}/pdf`
  )
  const transferSignal = quickBooksDocumentSignal(signal, QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS)
  const response = await fetch(url, {
    method: 'GET',
    headers: { ...buildQuickBooksHeaders(body.accessToken), Accept: 'application/pdf' },
    signal: transferSignal,
  })
  if (!response.ok) throw await getQuickBooksDocumentError(response, signal)

  const mimeType =
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (mimeType !== 'application/pdf') throw new Error('QuickBooks returned a non-PDF response')
  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: QUICKBOOKS_MAX_ATTACHMENT_BYTES,
    label: 'QuickBooks transaction PDF',
    signal: transferSignal,
  })
  if (buffer.length === 0) throw new Error('QuickBooks returned an empty PDF')
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-')
    throw new Error('QuickBooks returned malformed PDF content')

  return { buffer, mimeType, fileName }
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
      quickBooksDownloadDocumentContract,
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
    const body = parsed.data.body
    request.signal.throwIfAborted()

    const downloaded =
      body.documentKind === 'attachment'
        ? await downloadQuickBooksAttachment(body, request.signal)
        : await downloadQuickBooksTransactionPdf(body, request.signal)

    request.signal.throwIfAborted()
    const executionContext =
      body.workspaceId && body.workflowId && body.executionId
        ? {
            workspaceId: body.workspaceId,
            workflowId: body.workflowId,
            executionId: body.executionId,
          }
        : null
    const storedFile = userFileSchema.parse(
      executionContext
        ? await uploadExecutionFile(
            executionContext,
            downloaded.buffer,
            downloaded.fileName,
            downloaded.mimeType,
            authResult.userId
          )
        : await uploadCopilotFile({
            buffer: downloaded.buffer,
            fileName: downloaded.fileName,
            contentType: downloaded.mimeType,
            userId: authResult.userId,
          })
    )

    const shared = {
      file: storedFile,
      fileName: downloaded.fileName,
      mimeType: downloaded.mimeType,
      size: downloaded.buffer.length,
    }
    return NextResponse.json({
      success: true,
      output:
        body.documentKind === 'attachment'
          ? { ...shared, attachmentId: body.attachmentId }
          : {
              ...shared,
              transactionType: body.transactionType,
              transactionId: body.transactionId,
            },
    })
  } catch (error) {
    logger.error('QuickBooks document download failed', { error: getErrorMessage(error) })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to download QuickBooks document') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
