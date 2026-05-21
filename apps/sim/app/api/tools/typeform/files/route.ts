import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { typeformFilesContract } from '@/lib/api/contracts/tools/typeform'
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

const logger = createLogger('TypeformFilesAPI')
const MAX_TYPEFORM_FILE_BYTES = 10 * 1024 * 1024

export const dynamic = 'force-dynamic'

function buildTypeformFileUrl({
  formId,
  responseId,
  fieldId,
  filename,
  inline,
}: {
  formId: string
  responseId: string
  fieldId: string
  filename: string
  inline?: boolean
}): string {
  const encodedFormId = encodeURIComponent(formId)
  const encodedResponseId = encodeURIComponent(responseId)
  const encodedFieldId = encodeURIComponent(fieldId)
  const encodedFilename = encodeURIComponent(filename)
  const url = new URL(
    `https://api.typeform.com/forms/${encodedFormId}/responses/${encodedResponseId}/fields/${encodedFieldId}/files/${encodedFilename}`
  )
  if (inline !== undefined) {
    url.searchParams.set('inline', String(inline))
  }
  return url.toString()
}

function getFilename(
  response: { headers: { get(name: string): string | null } },
  fallback: string
): string {
  const contentDisposition = response.headers.get('content-disposition') || ''
  const filenameMatch = contentDisposition.match(/filename="(.+?)"/)
  return filenameMatch?.[1] || fallback || 'typeform-file'
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    typeformFilesContract,
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
    const fileUrl = buildTypeformFileUrl(body)
    const urlValidation = await validateUrlWithDNS(fileUrl, 'typeformFileUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json(
        { success: false, error: urlValidation.error || 'Invalid Typeform file URL' },
        { status: 400 }
      )
    }

    const response = await secureFetchWithPinnedIP(fileUrl, urlValidation.resolvedIP!, {
      headers: { Authorization: `Bearer ${body.apiKey}` },
      maxResponseBytes: MAX_TYPEFORM_FILE_BYTES,
    })

    if (!response.ok) {
      const errorText = await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Typeform file error response',
      }).catch(() => '')
      return NextResponse.json(
        {
          success: false,
          error: `Failed to download Typeform file: ${response.status} ${errorText}`,
        },
        { status: response.status }
      )
    }

    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_TYPEFORM_FILE_BYTES,
      label: 'Typeform file download',
    })
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const filename = getFilename(response, body.filename)
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
        contentType,
        authResult.userId
      )
      return NextResponse.json({
        success: true,
        output: {
          fileUrl: file.url,
          file: { ...file, mimeType: contentType },
          contentType,
          filename,
        },
      })
    }

    const file = await uploadCopilotFile({
      buffer,
      fileName: filename,
      contentType,
      userId: authResult.userId,
    })

    return NextResponse.json({
      success: true,
      output: {
        fileUrl: file.url || fileUrl,
        file,
        contentType,
        filename,
      },
    })
  } catch (error) {
    logger.error('Typeform file download failed', { error })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to download Typeform file') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
