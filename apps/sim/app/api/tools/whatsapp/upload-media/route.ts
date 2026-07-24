import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type WhatsAppUploadMediaRouteResponse,
  whatsappUploadMediaContract,
} from '@/lib/api/contracts/tools/whatsapp'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadWhatsAppMedia } from '@/app/api/tools/whatsapp/upload.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const logger = createLogger('WhatsAppUploadMediaAPI')

function failureResponse(error: string, status: number) {
  const body = { success: false, error } satisfies WhatsAppUploadMediaRouteResponse
  return NextResponse.json(body, { status })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    logger.warn(`[${requestId}] Unauthorized WhatsApp media upload attempt: ${authResult.error}`)
    return failureResponse(authResult.error || 'Authentication required', 401)
  }

  const parsed = await parseRequest(
    whatsappUploadMediaContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        failureResponse(getValidationErrorMessage(error, 'Invalid request data'), 400),
    }
  )
  if (!parsed.success) return parsed.response

  const { accessToken, phoneNumberId, file } = parsed.data.body

  try {
    const result = await uploadWhatsAppMedia({
      file,
      accessToken,
      phoneNumberId,
      userId: authResult.userId,
      requestId,
      logger,
      signal: request.signal,
    })

    if (!result.ok) {
      return 'response' in result ? result.response : failureResponse(result.error, result.status)
    }

    return NextResponse.json({
      success: true,
      output: result.media,
    } satisfies WhatsAppUploadMediaRouteResponse)
  } catch (error) {
    logger.error(`[${requestId}] WhatsApp media upload failed`, { error })
    return failureResponse(
      getErrorMessage(error, 'Failed to upload media to WhatsApp'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
})
