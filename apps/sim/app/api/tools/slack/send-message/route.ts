import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { sendSlackMessage } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackSendMessageAPI')

const SlackSendMessageSchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().optional().nullable(),
    userId: z.string().optional().nullable(),
    text: z.string().min(1, 'Message text is required'),
    thread_ts: z.string().optional().nullable(),
    files: RawFileInputArraySchema.optional().nullable(),
  })
  .refine((data) => data.channel || data.userId, {
    message: 'Either channel or userId is required',
  })

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Slack send request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = SlackSendMessageSchema.parse(body)

    const isDM = !!validatedData.userId
    logger.info(`[${requestId}] Sending Slack message`, {
      channel: validatedData.channel,
      userId: validatedData.userId,
      isDM,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    const result = await sendSlackMessage(
      {
        accessToken: validatedData.accessToken,
        channel: validatedData.channel ?? undefined,
        userId: validatedData.userId ?? undefined,
        text: validatedData.text,
        threadTs: validatedData.thread_ts ?? undefined,
        files: validatedData.files ?? undefined,
      },
      requestId,
      logger
    )

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, output: result.output })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Slack message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
