import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enqueueKnowledgeProjectionSweep } from '@/lib/knowledge/projection/enqueue'

const logger = createLogger('KnowledgeProjectionSweepRoute')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The knowledge projector's periodic sweep: enqueues one pass per window while documents are
 * marked, and returns once Trigger.dev accepts it. It is the only thing that starts a pass.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Knowledge projection sweep')
  if (authError) return authError

  try {
    const result = await enqueueKnowledgeProjectionSweep()
    return NextResponse.json({ success: true, ...result }, { status: result.triggered ? 202 : 200 })
  } catch (error) {
    logger.error('Knowledge projection sweep enqueue failed', { error: getErrorMessage(error) })
    return NextResponse.json({ success: false, error: 'Sweep enqueue failed' }, { status: 500 })
  }
})
