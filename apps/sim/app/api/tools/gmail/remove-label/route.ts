import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('GmailRemoveLabelAPI')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

const GmailRemoveLabelSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  labelIds: z.string().min(1, 'At least one label ID is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Gmail remove label attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Gmail remove label request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = GmailRemoveLabelSchema.parse(body)

    logger.info(`[${requestId}] Removing label(s) from Gmail email`, {
      messageId: validatedData.messageId,
      labelIds: validatedData.labelIds,
    })

    const labelIds = validatedData.labelIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)

    for (const labelId of labelIds) {
      const labelIdValidation = validateAlphanumericId(labelId, 'labelId', 255)
      if (!labelIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid label ID: ${labelIdValidation.error}`)
        return NextResponse.json(
          {
            success: false,
            error: labelIdValidation.error,
          },
          { status: 400 }
        )
      }
    }

    const messageIdValidation = validateAlphanumericId(validatedData.messageId, 'messageId', 255)
    if (!messageIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid message ID: ${messageIdValidation.error}`)
      return NextResponse.json(
        { success: false, error: messageIdValidation.error },
        { status: 400 }
      )
    }

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          removeLabelIds: labelIds,
        }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return NextResponse.json(
        {
          success: false,
          error: `Gmail API error: ${gmailResponse.statusText}`,
        },
        { status: gmailResponse.status }
      )
    }

    const data = await gmailResponse.json()

    logger.info(`[${requestId}] Label(s) removed successfully`, { messageId: data.id })

    return NextResponse.json({
      success: true,
      output: {
        content: `Successfully removed ${labelIds.length} label(s) from email`,
        metadata: {
          id: data.id,
          threadId: data.threadId,
          labelIds: data.labelIds,
        },
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

    logger.error(`[${requestId}] Error removing label from Gmail email:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
