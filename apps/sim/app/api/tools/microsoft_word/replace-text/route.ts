import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftWordReplaceTextContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { replaceTextInDocx } from '@/lib/microsoft-word/document.server'
import {
  downloadDocumentContent,
  fetchDocumentItem,
  replaceContentIfUnchanged,
  requireContentTag,
  toDocumentMetadata,
} from '@/lib/microsoft-word/graph.server'
import { microsoftWordErrorResponse } from '@/app/api/tools/microsoft_word/utils'
import { getDocumentBasePath } from '@/tools/microsoft_word/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftWordReplaceTextAPI')

/**
 * Finds and replaces text in a Word document. Graph exposes no document-editing
 * API, so the `.docx` is downloaded, its text parts rewritten in place, and the
 * repacked file uploaded back. Nothing is uploaded when no occurrence matched,
 * which keeps a no-op run from bumping the document's modified time.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.warn(`[${requestId}] Unauthorized Microsoft Word replace attempt: ${authResult.error}`)
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(microsoftWordReplaceTextContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, documentId, findText, replaceText, matchCase, driveId } = parsed.data.body

  try {
    const basePath = getDocumentBasePath(documentId, driveId ?? undefined)
    const existingItem = await fetchDocumentItem(basePath, accessToken)
    const contentTag = requireContentTag(existingItem)

    const existingBuffer = await downloadDocumentContent(basePath, accessToken)
    const { buffer, occurrencesChanged } = await replaceTextInDocx(
      existingBuffer,
      [{ find: findText, replace: replaceText ?? '' }],
      matchCase ?? false
    )

    if (occurrencesChanged === 0) {
      logger.info(`[${requestId}] No occurrences matched; document left untouched`, { documentId })
      return NextResponse.json({
        success: true,
        output: {
          occurrencesChanged: 0,
          metadata: toDocumentMetadata(existingItem, documentId),
        },
      })
    }

    const item = await replaceContentIfUnchanged(basePath, accessToken, buffer, contentTag)

    logger.info(`[${requestId}] Replaced text in Word document`, {
      documentId,
      occurrencesChanged,
    })

    return NextResponse.json({
      success: true,
      output: { occurrencesChanged, metadata: toDocumentMetadata(item, documentId) },
    })
  } catch (error) {
    return microsoftWordErrorResponse(error, requestId, logger, 'replace-text')
  }
})
