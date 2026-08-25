import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftWordCreateContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildDocxFromContent, DOCX_MIME_TYPE } from '@/lib/microsoft-word/document.server'
import { toDocumentMetadata, uploadDocumentContent } from '@/lib/microsoft-word/graph.server'
import { microsoftWordErrorResponse } from '@/app/api/tools/microsoft_word/utils'
import {
  ensureDocxExtension,
  getDriveBasePath,
  getFolderBasePath,
} from '@/tools/microsoft_word/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftWordCreateAPI')

/**
 * Creates a Word document. Sim generates the `.docx` package itself — Microsoft
 * Graph has no document-authoring API — and uploads it with the documented
 * path-addressed content upload.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.warn(`[${requestId}] Unauthorized Microsoft Word create attempt: ${authResult.error}`)
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(microsoftWordCreateContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, name, content, folderId, driveId } = parsed.data.body

  try {
    const fileName = ensureDocxExtension(name)
    const parentPath = folderId?.trim()
      ? getFolderBasePath(folderId, driveId ?? undefined)
      : `${getDriveBasePath(driveId ?? undefined)}/root`
    const uploadUrl = `${parentPath}:/${encodeURIComponent(fileName)}:/content`

    const documentBuffer = await buildDocxFromContent(content ?? '', name)
    const item = await uploadDocumentContent(uploadUrl, accessToken, documentBuffer, DOCX_MIME_TYPE)

    logger.info(`[${requestId}] Created Word document`, { documentId: item.id, size: item.size })

    return NextResponse.json({
      success: true,
      output: { metadata: toDocumentMetadata(item, item.id ?? '') },
    })
  } catch (error) {
    return microsoftWordErrorResponse(error, requestId, logger, 'create')
  }
})
