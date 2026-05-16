import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { outlookCopyContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookCopyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Outlook copy attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Outlook copy request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const parsed = await parseRequest(outlookCopyContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Copying Outlook email`, {
      messageId: validatedData.messageId,
      destinationId: validatedData.destinationId,
    })

    const graphEndpoint = `https://graph.microsoft.com/v1.0/me/messages/${validatedData.messageId}/copy`

    logger.info(`[${requestId}] Sending to Microsoft Graph API: ${graphEndpoint}`)

    const graphResponse = await fetch(graphEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        destinationId: validatedData.destinationId,
      }),
    })

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json().catch(() => ({}))
      logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || 'Failed to copy email',
        },
        { status: graphResponse.status }
      )
    }

    const responseData = await graphResponse.json()

    logger.info(`[${requestId}] Email copied successfully`, {
      originalMessageId: validatedData.messageId,
      copiedMessageId: responseData.id,
      destinationFolderId: responseData.parentFolderId,
    })

    return NextResponse.json({
      success: true,
      output: {
        message: 'Email copied successfully',
        originalMessageId: validatedData.messageId,
        copiedMessageId: responseData.id,
        destinationFolderId: responseData.parentFolderId,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error copying Outlook email:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Unknown error occurred'),
      },
      { status: 500 }
    )
  }
})
