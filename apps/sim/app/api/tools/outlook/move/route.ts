import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookMoveAPI')

const OutlookMoveSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  destinationId: z.string().min(1, 'Destination folder ID is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Outlook move attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Outlook move request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = OutlookMoveSchema.parse(body)

    logger.info(`[${requestId}] Moving Outlook email`, {
      messageId: validatedData.messageId,
      destinationId: validatedData.destinationId,
    })

    const graphEndpoint = `https://graph.microsoft.com/v1.0/me/messages/${validatedData.messageId}/move`

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
          error: errorData.error?.message || 'Failed to move email',
        },
        { status: graphResponse.status }
      )
    }

    const responseData = await graphResponse.json()

    logger.info(`[${requestId}] Email moved successfully`, {
      messageId: responseData.id,
      parentFolderId: responseData.parentFolderId,
    })

    return NextResponse.json({
      success: true,
      output: {
        message: 'Email moved successfully',
        messageId: responseData.id,
        newFolderId: responseData.parentFolderId,
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

    logger.error(`[${requestId}] Error moving Outlook email:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
