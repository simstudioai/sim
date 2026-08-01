import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type WhatsAppSendMediaRouteResponse,
  whatsappSendMediaContract,
} from '@/lib/api/contracts/tools/whatsapp'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadWhatsAppMedia } from '@/app/api/tools/whatsapp/upload.server'
import {
  buildAuthHeaders,
  buildMediaMessageBody,
  buildMessagesUrl,
  transformWhatsAppSendResponse,
} from '@/tools/whatsapp/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const logger = createLogger('WhatsAppSendMediaAPI')

function failureResponse(error: string, status: number) {
  const body = { success: false, error } satisfies WhatsAppSendMediaRouteResponse
  return NextResponse.json(body, { status })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    logger.warn(`[${requestId}] Unauthorized WhatsApp media send attempt: ${authResult.error}`)
    return failureResponse(authResult.error || 'Authentication required', 401)
  }

  const parsed = await parseRequest(
    whatsappSendMediaContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        failureResponse(getValidationErrorMessage(error, 'Invalid request data'), 400),
    }
  )
  if (!parsed.success) return parsed.response

  const body = parsed.data.body
  const suppliedSources = [body.file, body.mediaId, body.mediaLink].filter(Boolean).length
  if (suppliedSources === 0) {
    return failureResponse('Provide a file, a media ID, or a media link', 400)
  }
  if (suppliedSources > 1) {
    return failureResponse('Provide only one of file, media ID, or media link', 400)
  }

  try {
    // A dropped file has no WhatsApp identity yet, so upload it first and send the
    // resulting media ID. Media persists 30 days, so the ID is returned for reuse.
    let uploadedMediaId: string | undefined
    let filename = body.filename ?? undefined

    if (body.file) {
      const uploaded = await uploadWhatsAppMedia({
        file: body.file,
        accessToken: body.accessToken,
        phoneNumberId: body.phoneNumberId,
        userId: authResult.userId,
        requestId,
        logger,
        signal: request.signal,
      })

      if (!uploaded.ok) {
        return 'response' in uploaded
          ? uploaded.response
          : failureResponse(uploaded.error, uploaded.status)
      }

      uploadedMediaId = uploaded.media.mediaId
      filename = filename ?? uploaded.media.fileName
    }

    const messageBody = buildMediaMessageBody({
      phoneNumber: body.phoneNumber,
      mediaType: body.mediaType,
      mediaId: uploadedMediaId ?? body.mediaId ?? undefined,
      mediaLink: body.mediaLink ?? undefined,
      caption: body.caption ?? undefined,
      filename,
    })

    const response = await fetch(buildMessagesUrl(body.phoneNumberId), {
      method: 'POST',
      headers: buildAuthHeaders(body.accessToken),
      body: JSON.stringify(messageBody),
      signal: request.signal,
    })

    const sendResult = await transformWhatsAppSendResponse(response)

    // transformWhatsAppSendResponse throws on a non-OK send, so reaching here means success.
    return NextResponse.json({
      success: true,
      output: {
        ...sendResult.output,
        success: true,
        messageId: sendResult.output.messageId ?? '',
        inputPhoneNumber: sendResult.output.inputPhoneNumber ?? null,
        whatsappUserId: sendResult.output.whatsappUserId ?? null,
        contacts: sendResult.output.contacts ?? [],
        ...(uploadedMediaId ? { mediaId: uploadedMediaId } : {}),
      },
    } satisfies WhatsAppSendMediaRouteResponse)
  } catch (error) {
    logger.error(`[${requestId}] WhatsApp media send failed`, { error })
    return failureResponse(
      getErrorMessage(error, 'Failed to send WhatsApp media'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
})
