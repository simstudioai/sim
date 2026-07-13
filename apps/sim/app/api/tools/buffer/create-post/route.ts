import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { bufferCreatePostContract } from '@/lib/api/contracts/tools/buffer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { forwardPostMutation } from '@/app/api/tools/buffer/server-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('BufferCreatePostAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Buffer create post attempt`, {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      bufferCreatePostContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request data`, { errors: error.issues })
          return NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    return await forwardPostMutation({
      apiKey: body.apiKey,
      channelId: body.channelId,
      text: body.text,
      mode: body.mode,
      schedulingType: body.schedulingType,
      dueAt: body.dueAt,
      saveToDraft: body.saveToDraft,
      media: body.media,
      mediaAltText: body.mediaAltText,
      userId: authResult.userId,
      requestId,
      logger,
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to create post')
    logger.error(`[${requestId}] Buffer create post failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
