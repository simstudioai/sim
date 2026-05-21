import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { googleSlidesExportPresentationContract } from '@/lib/api/contracts/tools/google'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { presentationUrl } from '@/tools/google_slides/utils'

const logger = createLogger('GoogleSlidesExportAPI')
const MAX_GOOGLE_SLIDES_EXPORT_BYTES = 10 * 1024 * 1024
const MAX_LEGACY_INLINE_EXPORT_BYTES = 7 * 1024 * 1024

const FORMAT_TO_MIME = {
  PDF: 'application/pdf',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ODP: 'application/vnd.oasis.opendocument.presentation',
  TXT: 'text/plain',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  SVG: 'image/svg+xml',
} as const

export const dynamic = 'force-dynamic'

function buildExportUrl(presentationId: string, exportFormat: keyof typeof FORMAT_TO_MIME): string {
  const mimeType = FORMAT_TO_MIME[exportFormat]
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(presentationId)}/export?mimeType=${encodeURIComponent(mimeType)}`
}

function buildExportFilename(
  presentationId: string,
  exportFormat: keyof typeof FORMAT_TO_MIME
): string {
  return `${presentationId}.${exportFormat.toLowerCase()}`
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    googleSlidesExportPresentationContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json(
          { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
          { status: 400 }
        ),
    }
  )
  if (!parsed.success) return parsed.response

  try {
    const body = parsed.data.body
    const exportFormat = body.exportFormat ?? 'PDF'
    const mimeType = FORMAT_TO_MIME[exportFormat]
    const exportUrl = buildExportUrl(body.presentationId, exportFormat)
    const urlValidation = await validateUrlWithDNS(exportUrl, 'googleSlidesExportUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json(
        { success: false, error: urlValidation.error || 'Invalid Google Slides export URL' },
        { status: 400 }
      )
    }

    const response = await secureFetchWithPinnedIP(exportUrl, urlValidation.resolvedIP!, {
      headers: { Authorization: `Bearer ${body.accessToken}` },
      maxResponseBytes: MAX_GOOGLE_SLIDES_EXPORT_BYTES,
    })

    if (!response.ok) {
      const errorText = await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Google Slides export error response',
      }).catch(() => '')
      return NextResponse.json(
        {
          success: false,
          error: `Failed to export presentation: ${response.status} ${errorText}`,
        },
        { status: response.status }
      )
    }

    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_GOOGLE_SLIDES_EXPORT_BYTES,
      label: 'Google Slides export response',
    })
    const filename = buildExportFilename(body.presentationId, exportFormat)
    const legacyInlineContent =
      buffer.length <= MAX_LEGACY_INLINE_EXPORT_BYTES
        ? { contentBase64: buffer.toString('base64') }
        : {}
    const executionContext =
      body.workspaceId && body.workflowId && body.executionId
        ? {
            workspaceId: body.workspaceId,
            workflowId: body.workflowId,
            executionId: body.executionId,
          }
        : undefined

    if (executionContext) {
      const file = await uploadExecutionFile(
        executionContext,
        buffer,
        filename,
        mimeType,
        authResult.userId
      )
      return NextResponse.json({
        success: true,
        output: {
          file: { ...file, mimeType },
          exportFormat,
          mimeType,
          sizeBytes: buffer.length,
          exportUrl: file.url,
          ...legacyInlineContent,
          metadata: {
            presentationId: body.presentationId,
            url: presentationUrl(body.presentationId),
            exportFormat,
          },
        },
      })
    }

    const file = await uploadCopilotFile({
      buffer,
      fileName: filename,
      contentType: mimeType,
      userId: authResult.userId,
    })

    return NextResponse.json({
      success: true,
      output: {
        file,
        exportUrl: file.url,
        exportFormat,
        mimeType,
        sizeBytes: buffer.length,
        ...legacyInlineContent,
        metadata: {
          presentationId: body.presentationId,
          url: presentationUrl(body.presentationId),
          exportFormat,
        },
      },
    })
  } catch (error) {
    logger.error('Google Slides export failed', { error })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to export presentation') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
