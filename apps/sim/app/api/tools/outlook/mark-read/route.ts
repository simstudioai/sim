import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { outlookMarkReadContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookMarkReadAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Outlook mark read attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Outlook mark read request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseRequest(outlookMarkReadContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Marking Outlook email as read`, {
      messageId: validatedData.messageId,
    })

    const graphEndpoint = `https://graph.microsoft.com/v1.0/me/messages/${validatedData.messageId}`

    logger.info(`[${requestId}] Sending to Microsoft Graph API: ${graphEndpoint}`)

    const graphResponse = await fetch(graphEndpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        isRead: true,
      }),
    })

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json().catch(() => ({}))
      logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || 'Failed to mark email as read',
        },
        { status: graphResponse.status }
      )
    }

    const responseData = await graphResponse.json()

    logger.info(`[${requestId}] Email marked as read successfully`, {
      messageId: responseData.id,
      isRead: responseData.isRead,
    })

    return NextResponse.json({
      success: true,
      output: {
        message: 'Email marked as read successfully',
        messageId: responseData.id,
        isRead: responseData.isRead,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error marking Outlook email as read:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Unknown error occurred'),
      },
      { status: 500 }
    )
  }
})
