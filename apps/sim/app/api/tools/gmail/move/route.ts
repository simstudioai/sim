import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GmailMoveAPI')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

const GmailMoveSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  addLabelIds: z.string().min(1, 'At least one label to add is required'),
  removeLabelIds: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Gmail move attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Gmail move request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = GmailMoveSchema.parse(body)

    logger.info(`[${requestId}] Moving Gmail email`, {
      messageId: validatedData.messageId,
      addLabelIds: validatedData.addLabelIds,
      removeLabelIds: validatedData.removeLabelIds,
    })

    const addLabelIds = validatedData.addLabelIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)

    const removeLabelIds = validatedData.removeLabelIds
      ? validatedData.removeLabelIds
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : []

    const modifyBody: { addLabelIds?: string[]; removeLabelIds?: string[] } = {}

    if (addLabelIds.length > 0) {
      modifyBody.addLabelIds = addLabelIds
    }

    if (removeLabelIds.length > 0) {
      modifyBody.removeLabelIds = removeLabelIds
    }

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(modifyBody),
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

    logger.info(`[${requestId}] Email moved successfully`, { messageId: data.id })

    return NextResponse.json({
      success: true,
      output: {
        content: 'Email moved successfully',
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

    logger.error(`[${requestId}] Error moving Gmail email:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
