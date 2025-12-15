import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { createLogger } from '@/lib/logs/console/logger'
import { openDMChannel, sendSlackMessage } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackSendDMAPI')

const SlackSendDMSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  userId: z.string().min(1, 'User ID is required'),
  text: z.string().min(1, 'Message text is required'),
  thread_ts: z.string().optional().nullable(),
  files: z.array(z.any()).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack DM send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Slack DM request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = SlackSendDMSchema.parse(body)

    logger.info(`[${requestId}] Sending Slack DM`, {
      targetUserId: validatedData.userId,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    // Open DM channel with the user
    const dmChannelId = await openDMChannel(
      validatedData.accessToken,
      validatedData.userId,
      requestId,
      logger
    )

    const result = await sendSlackMessage(
      {
        accessToken: validatedData.accessToken,
        channel: dmChannelId,
        text: validatedData.text,
        threadTs: validatedData.thread_ts,
        files: validatedData.files,
      },
      requestId,
      logger
    )

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, output: result.output })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Slack DM:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
