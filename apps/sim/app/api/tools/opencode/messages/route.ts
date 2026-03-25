import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getOpenCodeMessages } from '@/lib/opencode/service'

const logger = createLogger('OpenCodeMessagesToolAPI')

const OpenCodeMessagesSchema = z.object({
  repository: z.string().min(1, 'repository is required'),
  threadId: z.string().min(1, 'threadId is required'),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized OpenCode messages request`)
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
    }

    const body = OpenCodeMessagesSchema.parse(await request.json())
    const messages = await getOpenCodeMessages(body.repository, body.threadId)

    return NextResponse.json({
      success: true,
      output: {
        threadId: body.threadId,
        messages,
        count: messages.length,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch OpenCode messages`, { error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch OpenCode messages' },
      { status: 500 }
    )
  }
}
