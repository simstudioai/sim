import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftWordUpdateContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildDocxFromContent, DOCX_MIME_TYPE } from '@/lib/microsoft-word/document.server'
import {
  fetchDocumentItem,
  toDocumentMetadata,
  uploadDocumentContent,
} from '@/lib/microsoft-word/graph.server'
import { microsoftWordErrorResponse } from '@/app/api/tools/microsoft_word/utils'
import { getDocumentBasePath } from '@/tools/microsoft_word/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftWordUpdateAPI')

/**
 * Replaces a Word document's contents with a freshly generated `.docx` package.
 * The metadata read first confirms the target is a file rather than a folder, so
 * the destructive upload cannot land on the wrong kind of drive item.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.warn(`[${requestId}] Unauthorized Microsoft Word update attempt: ${authResult.error}`)
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(microsoftWordUpdateContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, documentId, content, driveId } = parsed.data.body

  try {
    const basePath = getDocumentBasePath(documentId, driveId ?? undefined)
    const existing = await fetchDocumentItem(basePath, accessToken)

    const documentBuffer = await buildDocxFromContent(content, existing.name)
    const item = await uploadDocumentContent(
      `${basePath}/content`,
      accessToken,
      documentBuffer,
      DOCX_MIME_TYPE
    )

    logger.info(`[${requestId}] Replaced Word document contents`, {
      documentId,
      size: item.size,
    })

    return NextResponse.json({
      success: true,
      output: { updatedContent: true, metadata: toDocumentMetadata(item, documentId) },
    })
  } catch (error) {
    return microsoftWordErrorResponse(error, requestId, logger, 'update')
  }
})
