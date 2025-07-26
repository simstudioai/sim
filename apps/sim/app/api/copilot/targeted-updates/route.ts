import { type NextRequest, NextResponse } from 'next/server'
import { executeCopilotTool } from '@/lib/copilot/tools'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('TargetedUpdatesAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { operations, workflowId } = body

    if (!operations || !Array.isArray(operations)) {
      return NextResponse.json(
        { success: false, error: 'Operations array is required' },
        { status: 400 }
      )
    }

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    logger.info('Executing targeted updates', {
      workflowId,
      operationCount: operations.length,
      operations: operations.map((op) => ({ type: op.operation_type, blockId: op.block_id })),
    })

    const result = await executeCopilotTool('targeted_updates', {
      operations,
      _context: { workflowId },
    })

    return NextResponse.json(result)
  } catch (error) {
    logger.error('Targeted updates API failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
