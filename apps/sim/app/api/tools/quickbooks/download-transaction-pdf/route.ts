import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { quickBooksDownloadTransactionPdfContract } from '@/lib/api/contracts/tools/quickbooks'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  isPayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { buildQuickBooksCompanyUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/client'
import {
  getQuickBooksDocumentError,
  getQuickBooksDocumentTransaction,
  sanitizeQuickBooksFileName,
} from '@/tools/quickbooks/documents_utils'

export const dynamic = 'force-dynamic'
const logger = createLogger('QuickBooksDownloadTransactionPdfAPI')

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
      quickBooksDownloadTransactionPdfContract,
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
    const { accessToken, realmId, transactionType, transactionId, fileName } = parsed.data.body
    const { resource } = getQuickBooksDocumentTransaction(transactionType)
    const url = buildQuickBooksCompanyUrl(
      realmId,
      `${resource}/${encodeURIComponent(transactionId)}/pdf`
    )
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...buildQuickBooksHeaders(accessToken), Accept: 'application/pdf' },
    })
    if (!response.ok) throw await getQuickBooksDocumentError(response)

    const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (mimeType !== 'application/pdf') throw new Error('QuickBooks returned a non-PDF response')
    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_FILE_SIZE,
      label: 'QuickBooks transaction PDF',
    })
    if (buffer.length === 0) throw new Error('QuickBooks returned an empty PDF')
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('QuickBooks returned malformed PDF content')
    }
    const resolvedName = sanitizeQuickBooksFileName(
      fileName ?? undefined,
      `quickbooks-${transactionType.replaceAll('_', '-')}-${transactionId}.pdf`
    )
    if (!resolvedName.toLowerCase().endsWith('.pdf'))
      throw new Error('PDF filename must end in .pdf')

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        transactionType,
        transactionId,
        fileName: resolvedName,
        mimeType,
        size: buffer.length,
      },
    })
  } catch (error) {
    logger.error('QuickBooks transaction PDF download failed', { error: getErrorMessage(error) })
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Failed to download QuickBooks transaction PDF'),
      },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
