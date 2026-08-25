import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftWordCreateFromTemplateContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  DOCX_MIME_TYPE,
  parseReplacements,
  replaceTextInDocx,
} from '@/lib/microsoft-word/document.server'
import {
  downloadDocumentContent,
  fetchDocumentItem,
  toDocumentMetadata,
  uploadDocumentContent,
} from '@/lib/microsoft-word/graph.server'
import { microsoftWordErrorResponse } from '@/app/api/tools/microsoft_word/utils'
import {
  ensureDocxExtension,
  getDocumentBasePath,
  getDriveBasePath,
  getFolderBasePath,
} from '@/tools/microsoft_word/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftWordCreateFromTemplateAPI')

/**
 * Fills a Word template into a new document. The template is downloaded, its
 * placeholders substituted in memory, and the result uploaded under a new name —
 * so the template itself is never written to, and the copy keeps every style,
 * header, footer, and image the template defined.
 *
 * Graph's `copy` action is deliberately not used: it is asynchronous and only
 * answers with a monitor URL, which would force a poll before the new document
 * could be filled.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.warn(`[${requestId}] Unauthorized Microsoft Word template attempt: ${authResult.error}`)
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(microsoftWordCreateFromTemplateContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, templateDocumentId, name, replacements, matchCase, folderId, driveId } =
    parsed.data.body

  try {
    const templatePath = getDocumentBasePath(templateDocumentId, driveId ?? undefined)
    await fetchDocumentItem(templatePath, accessToken)

    const templateBuffer = await downloadDocumentContent(templatePath, accessToken)
    const pairs = parseReplacements(replacements)

    const filled =
      pairs.length > 0
        ? await replaceTextInDocx(templateBuffer, pairs, matchCase ?? false)
        : { buffer: templateBuffer, occurrencesChanged: 0 }

    const fileName = ensureDocxExtension(name)
    const parentPath = folderId?.trim()
      ? getFolderBasePath(folderId, driveId ?? undefined)
      : `${getDriveBasePath(driveId ?? undefined)}/root`
    const uploadUrl = `${parentPath}:/${encodeURIComponent(fileName)}:/content`

    const item = await uploadDocumentContent(uploadUrl, accessToken, filled.buffer, DOCX_MIME_TYPE)

    logger.info(`[${requestId}] Created Word document from template`, {
      templateDocumentId,
      documentId: item.id,
      occurrencesChanged: filled.occurrencesChanged,
    })

    return NextResponse.json({
      success: true,
      output: {
        occurrencesChanged: filled.occurrencesChanged,
        metadata: toDocumentMetadata(item, item.id ?? ''),
      },
    })
  } catch (error) {
    return microsoftWordErrorResponse(error, requestId, logger, 'create-from-template')
  }
})
