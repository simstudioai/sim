import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { markExecutionCancelled } from '@/lib/execution/cancellation'

const logger = createLogger('CancelExecutionAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const { id: workflowId, executionId } = await params

  try {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    logger.info('Cancel execution requested', { workflowId, executionId, userId: auth.userId })

    const marked = await markExecutionCancelled(executionId)

    if (marked) {
      logger.info('Execution marked as cancelled in Redis', { executionId })
    } else {
      logger.info('Redis not available, cancellation will rely on connection close', {
        executionId,
      })
    }

    return NextResponse.json({
      success: true,
      executionId,
      redisAvailable: marked,
    })
  } catch (error: any) {
    logger.error('Failed to cancel execution', { workflowId, executionId, error: error.message })
    return NextResponse.json(
      { error: error.message || 'Failed to cancel execution' },
      { status: 500 }
    )
  }
}
