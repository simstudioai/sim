import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookCopyAPI')

const OutlookCopySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  destinationId: z.string().min(1, 'Destination folder ID is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

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

    const body = await request.json()
    const validatedData = OutlookCopySchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error copying Outlook email:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
