import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/mothership/request/http'
import { subscribeTaskToExecution } from '@/lib/mothership/tasks/subscriptions'

const logger = createLogger('CopilotTaskSubscribeAPI')

const BodySchema = z.object({
  taskId: z.string().uuid(),
  executionId: z.string().min(1).max(200),
  chatId: z.string().uuid(),
  workspaceId: z.string().min(1),
})

/**
 * POST /api/mothership/tasks/subscribe — the worker registers a background task's watch on
 * a workflow execution; the execution's completion posts back to the worker. Internal
 * only: the shared `x-api-key: INTERNAL_API_SECRET` the worker sends for billing.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) return createUnauthorizedResponse()
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  try {
    const outcome = await subscribeTaskToExecution(parsed.data)
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Task subscription failed', {
      taskId: parsed.data.taskId,
      error: getErrorMessage(error),
    })
    return NextResponse.json({ error: 'Subscription failed' }, { status: 500 })
  }
})
