import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { getToolExecutionState } from '@/lib/copilot/server-executor/stream-handler'

const logger = createLogger('ToolExecutionStatesAPI')

const RequestSchema = z.object({
  toolCallIds: z.array(z.string()).min(1).max(50),
})

/**
 * POST /api/copilot/tools/execution-states
 *
 * Returns the execution states of multiple tool calls at once.
 * Useful for efficient reconnection scenarios.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { toolCallIds } = RequestSchema.parse(body)

    const states: Record<
      string,
      {
        toolCallId: string
        toolName: string
        status: string
        startedAt: number
        completedAt?: number
        result?: unknown
        error?: string
      } | null
    > = {}

    // Fetch all states in parallel
    const results = await Promise.all(
      toolCallIds.map(async (toolCallId) => {
        const state = await getToolExecutionState(toolCallId)
        // Filter out states that don't belong to this user
        if (state && state.userId !== userId) {
          return { toolCallId, state: null }
        }
        return { toolCallId, state }
      })
    )

    for (const { toolCallId, state } of results) {
      if (state) {
        states[toolCallId] = {
          toolCallId: state.toolCallId,
          toolName: state.toolName,
          status: state.status,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
          result: state.result,
          error: state.error,
        }
      } else {
        states[toolCallId] = null
      }
    }

    return NextResponse.json({ states })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse('Invalid request body')
    }

    logger.error('Error fetching tool execution states', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
