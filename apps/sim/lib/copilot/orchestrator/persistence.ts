import { createLogger } from '@sim/logger'
import { REDIS_TOOL_CALL_PREFIX } from '@/lib/copilot/constants'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('CopilotOrchestratorPersistence')

/**
 * Get a tool call confirmation status from Redis.
 */
export async function getToolConfirmation(toolCallId: string): Promise<{
  status: string
  message?: string
  timestamp?: string
  data?: Record<string, unknown>
} | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const raw = await redis.get(`${REDIS_TOOL_CALL_PREFIX}${toolCallId}`)
    if (!raw) return null
    return JSON.parse(raw) as {
      status: string
      message?: string
      timestamp?: string
      data?: Record<string, unknown>
    }
  } catch (error) {
    logger.error('Failed to read tool confirmation', {
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
