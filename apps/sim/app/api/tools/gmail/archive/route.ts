import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { gmailArchiveContract } from '@/lib/api/contracts/tools/google'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('GmailArchiveAPI')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Gmail archive attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Gmail archive request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const parsed = await parseRequest(gmailArchiveContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Archiving Gmail email`, {
      messageId: validatedData.messageId,
    })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          removeLabelIds: ['INBOX'],
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

    logger.info(`[${requestId}] Email archived successfully`, { messageId: data.id })

    return NextResponse.json({
      success: true,
      output: {
        content: 'Email archived successfully',
        metadata: {
          id: data.id,
          threadId: data.threadId,
          labelIds: data.labelIds,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error archiving Gmail email:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
