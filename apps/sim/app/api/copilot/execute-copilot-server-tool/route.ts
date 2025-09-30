import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ExecuteCopilotServerToolAPI')

const ExecuteSchema = z.object({
  toolName: z.string(),
  payload: z.unknown().optional(),
})

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    try {
      const preview = JSON.stringify(body).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Incoming request body preview`, { preview })
    } catch {}

    const { toolName, payload } = ExecuteSchema.parse(body)

    logger.info(`[${tracker.requestId}] Executing server tool`, { toolName })
    const result = await routeExecution(toolName, payload, { userId })

    try {
      const resultPreview = JSON.stringify(result).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Server tool result preview`, { toolName, resultPreview })
    } catch {}

    return NextResponse.json({ success: true, result })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug(`[${tracker.requestId}] Zod validation error`, { issues: error.issues })
      return createBadRequestResponse('Invalid request body for execute-copilot-server-tool')
    }
    logger.error(`[${tracker.requestId}] Failed to execute server tool:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute server tool'
    return createInternalServerErrorResponse(errorMessage)
  }
}
