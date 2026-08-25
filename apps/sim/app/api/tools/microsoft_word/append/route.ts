import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftWordAppendContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { appendParagraphsToDocx, DOCX_MIME_TYPE } from '@/lib/microsoft-word/document.server'
import {
  assertContentUnchanged,
  downloadDocumentContent,
  fetchDocumentItem,
  getContentTag,
  toDocumentMetadata,
  uploadDocumentContent,
} from '@/lib/microsoft-word/graph.server'
import { microsoftWordErrorResponse } from '@/app/api/tools/microsoft_word/utils'
import { getDocumentBasePath } from '@/tools/microsoft_word/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftWordAppendAPI')

/**
 * Appends paragraphs to a Word document. Graph exposes no document-editing API,
 * so the existing `.docx` is downloaded, its body extended in place, and the
 * repacked file uploaded back — every other part of the package is preserved.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.warn(`[${requestId}] Unauthorized Microsoft Word append attempt: ${authResult.error}`)
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(microsoftWordAppendContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, documentId, content, driveId } = parsed.data.body

  try {
    const basePath = getDocumentBasePath(documentId, driveId ?? undefined)
    const contentTag = getContentTag(await fetchDocumentItem(basePath, accessToken))

    const existingBuffer = await downloadDocumentContent(basePath, accessToken)
    const updatedBuffer = await appendParagraphsToDocx(existingBuffer, content)

    await assertContentUnchanged(basePath, accessToken, contentTag)

    const item = await uploadDocumentContent(
      `${basePath}/content`,
      accessToken,
      updatedBuffer,
      DOCX_MIME_TYPE,
      contentTag
    )

    logger.info(`[${requestId}] Appended to Word document`, { documentId, size: item.size })

    return NextResponse.json({
      success: true,
      output: { updatedContent: true, metadata: toDocumentMetadata(item, documentId) },
    })
  } catch (error) {
    return microsoftWordErrorResponse(error, requestId, logger, 'append')
  }
})
