import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { after, type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/mothership/request/http'
import { runWakeTurn, validateWake } from '@/lib/mothership/tasks/wake'

const logger = createLogger('CopilotWakeAPI')

const BodySchema = z.object({
  taskId: z.string().uuid(),
  chatId: z.string().uuid(),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  message: z.string().min(1).max(20_000),
  status: z.enum(['completed', 'failed', 'stopped', 'expired']).optional(),
  summary: z.string().max(4000).optional(),
})

/**
 * POST /api/mothership/wake — the worker delivers a background task's notification to an
 * idle chat by asking sim to open a headless turn with it. Answers 202 once the chat is
 * validated; the turn itself runs after the response (a wake is fire-and-forget for the
 * worker, whose sweeper re-asks if this never lands). Internal only.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) return createUnauthorizedResponse()
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  try {
    const valid = await validateWake(parsed.data)
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: valid.status })
  } catch (error) {
    logger.error('Wake validation failed', {
      taskId: parsed.data.taskId,
      error: getErrorMessage(error),
    })
    return NextResponse.json({ error: 'Wake validation failed' }, { status: 500 })
  }
  after(() => runWakeTurn(parsed.data))
  return NextResponse.json({ accepted: true }, { status: 202 })
})
