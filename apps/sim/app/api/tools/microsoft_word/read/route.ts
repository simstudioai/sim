import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftWordReadContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { extractDocxText } from '@/lib/microsoft-word/document.server'
import {
  downloadDocumentContent,
  fetchDocumentItem,
  toDocumentMetadata,
} from '@/lib/microsoft-word/graph.server'
import { microsoftWordErrorResponse } from '@/app/api/tools/microsoft_word/utils'
import { getDocumentBasePath } from '@/tools/microsoft_word/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftWordReadAPI')

/**
 * Reads a Word document's text. Graph serves the raw `.docx` package, so the
 * bytes are extracted with Sim's shared DOCX parser rather than by the API.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.warn(`[${requestId}] Unauthorized Microsoft Word read attempt: ${authResult.error}`)
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(microsoftWordReadContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, documentId, driveId } = parsed.data.body

  try {
    const basePath = getDocumentBasePath(documentId, driveId ?? undefined)
    const item = await fetchDocumentItem(basePath, accessToken)
    const documentBuffer = await downloadDocumentContent(basePath, accessToken)
    const content = await extractDocxText(documentBuffer)

    logger.info(`[${requestId}] Read Word document`, {
      documentId,
      characterCount: content.length,
    })

    return NextResponse.json({
      success: true,
      output: { content, metadata: toDocumentMetadata(item, documentId) },
    })
  } catch (error) {
    return microsoftWordErrorResponse(error, requestId, logger, 'read')
  }
})
