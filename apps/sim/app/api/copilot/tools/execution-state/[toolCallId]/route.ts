import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  authenticateCopilotRequestSessionOnly,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { getToolExecutionState } from '@/lib/copilot/server-executor/stream-handler'

const logger = createLogger('ToolExecutionStateAPI')

/**
 * GET /api/copilot/tools/execution-state/[toolCallId]
 *
 * Returns the execution state of a tool call.
 * Useful for client reconnection scenarios.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ toolCallId: string }> }
) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const { toolCallId } = await params

    if (!toolCallId) {
      return NextResponse.json({ error: 'Tool call ID is required' }, { status: 400 })
    }

    const state = await getToolExecutionState(toolCallId)

    if (!state) {
      return NextResponse.json({ error: 'Tool call not found' }, { status: 404 })
    }

    // Verify the user owns this tool execution
    if (state.userId !== userId) {
      logger.warn("User attempted to access another user's tool execution", {
        requestingUserId: userId,
        ownerUserId: state.userId,
        toolCallId,
      })
      return NextResponse.json({ error: 'Tool call not found' }, { status: 404 })
    }

    return NextResponse.json({
      toolCallId: state.toolCallId,
      toolName: state.toolName,
      status: state.status,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      result: state.result,
      error: state.error,
    })
  } catch (error) {
    logger.error('Error fetching tool execution state', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
