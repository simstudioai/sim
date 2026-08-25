import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftWordExportPdfContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { downloadConvertedContent, fetchDocumentItem } from '@/lib/microsoft-word/graph.server'
import { microsoftWordErrorResponse } from '@/app/api/tools/microsoft_word/utils'
import { getDocumentBasePath } from '@/tools/microsoft_word/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftWordExportPdfAPI')

const PDF_MIME_TYPE = 'application/pdf'

/** Derives the PDF file name from an explicit override or the source document name. */
function resolvePdfName(override: string | null | undefined, documentName?: string): string {
  const explicit = override?.trim()
  if (explicit) {
    return explicit.toLowerCase().endsWith('.pdf') ? explicit : `${explicit}.pdf`
  }

  const base = documentName?.trim().replace(/\.docx$/i, '')
  return base ? `${base}.pdf` : 'document.pdf'
}

/**
 * Exports a Word document as PDF. Graph performs the conversion and answers with
 * a redirect to a short-lived preauthenticated download URL, which the shared
 * secure fetch follows without forwarding the bearer token.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-get-content-format
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.warn(`[${requestId}] Unauthorized Microsoft Word export attempt: ${authResult.error}`)
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(microsoftWordExportPdfContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, documentId, fileName, driveId } = parsed.data.body

  try {
    const basePath = getDocumentBasePath(documentId, driveId ?? undefined)
    const item = await fetchDocumentItem(basePath, accessToken)
    const pdfBuffer = await downloadConvertedContent(basePath, accessToken, 'pdf')

    const name = resolvePdfName(fileName, item.name)

    logger.info(`[${requestId}] Exported Word document as PDF`, {
      documentId,
      name,
      size: pdfBuffer.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name,
          mimeType: PDF_MIME_TYPE,
          data: pdfBuffer.toString('base64'),
          size: pdfBuffer.length,
        },
      },
    })
  } catch (error) {
    return microsoftWordErrorResponse(error, requestId, logger, 'export-pdf')
  }
})
