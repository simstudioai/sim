/**
 * SSE Stream Tool Execution Handler
 *
 * This module intercepts tool_call events from the Go copilot SSE stream
 * and executes server-side tools, calling mark-complete to return results.
 *
 * Key features:
 * - Non-blocking: Tool execution happens in parallel with stream forwarding
 * - Resilient: Uses Redis for state persistence across disconnects
 * - Transparent: Still forwards all events to browser for UI updates
 */

import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'
import { executeToolOnServer, isServerExecutedTool } from './index'
import type { ExecutionContext } from './types'

const logger = createLogger('StreamToolHandler')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

/** Redis key prefix for tool execution state */
const REDIS_KEY_PREFIX = 'copilot:tool_exec:'

/** TTL for Redis entries (1 hour) */
const REDIS_TTL_SECONDS = 60 * 60

/**
 * Tool execution state stored in Redis
 */
interface ToolExecutionState {
  toolCallId: string
  toolName: string
  status: 'pending' | 'executing' | 'completed' | 'failed'
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  startedAt: number
  completedAt?: number
  result?: unknown
  error?: string
}

/**
 * Tool call data from SSE event
 */
interface ToolCallEvent {
  id: string
  name: string
  arguments: Record<string, unknown>
  partial?: boolean
}

/**
 * Save tool execution state to Redis.
 */
async function saveToolState(state: ToolExecutionState): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    logger.debug('Redis not available, skipping state save', {
      toolCallId: state.toolCallId,
    })
    return
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${state.toolCallId}`
    await redis.setex(key, REDIS_TTL_SECONDS, JSON.stringify(state))
    logger.debug('Saved tool execution state to Redis', {
      toolCallId: state.toolCallId,
      status: state.status,
    })
  } catch (error) {
    logger.warn('Failed to save tool state to Redis', {
      toolCallId: state.toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Get tool execution state from Redis.
 */
async function getToolState(toolCallId: string): Promise<ToolExecutionState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const key = `${REDIS_KEY_PREFIX}${toolCallId}`
    const data = await redis.get(key)
    if (!data) return null
    return JSON.parse(data) as ToolExecutionState
  } catch (error) {
    logger.warn('Failed to get tool state from Redis', {
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Mark a tool as complete by calling the Go copilot endpoint.
 */
async function markToolComplete(
  toolCallId: string,
  toolName: string,
  status: number,
  message?: unknown,
  data?: unknown
): Promise<boolean> {
  try {
    const payload = {
      id: toolCallId,
      name: toolName,
      status,
      message,
      data,
    }

    logger.info('Marking tool complete from server', {
      toolCallId,
      toolName,
      status,
      hasMessage: message !== undefined,
      hasData: data !== undefined,
    })

    const response = await fetch(`${SIM_AGENT_API_URL}/api/tools/mark-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to mark tool complete', {
        toolCallId,
        toolName,
        status: response.status,
        error: errorText,
      })
      return false
    }

    logger.info('Tool marked complete successfully', { toolCallId, toolName })
    return true
  } catch (error) {
    logger.error('Error marking tool complete', {
      toolCallId,
      toolName,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Handle a tool call event from the SSE stream.
 *
 * If the tool is server-executed:
 * 1. Execute it using the server executor
 * 2. Call mark-complete to return result to Go
 *
 * This runs asynchronously and doesn't block the stream.
 *
 * @returns true if this tool will be handled server-side, false if client should handle
 */
export async function handleToolCallEvent(
  event: ToolCallEvent,
  context: ExecutionContext
): Promise<boolean> {
  // Skip partial tool calls (streaming arguments)
  if (event.partial) {
    return false
  }

  // Check if this tool should be executed server-side
  if (!isServerExecutedTool(event.name)) {
    logger.debug('Tool not server-executed, client will handle', {
      toolCallId: event.id,
      toolName: event.name,
    })
    return false
  }

  // Check if this tool is already being executed (recovery scenario)
  const existingState = await getToolState(event.id)
  if (existingState) {
    if (existingState.status === 'executing') {
      logger.info('Tool already being executed (recovery scenario)', {
        toolCallId: event.id,
        toolName: event.name,
        startedAt: existingState.startedAt,
      })
      return true
    }
    if (existingState.status === 'completed') {
      logger.info('Tool already completed (recovery scenario)', {
        toolCallId: event.id,
        toolName: event.name,
        completedAt: existingState.completedAt,
      })
      return true
    }
  }

  logger.info('Handling tool call server-side', {
    toolCallId: event.id,
    toolName: event.name,
    userId: context.userId,
  })

  // Save initial state to Redis
  await saveToolState({
    toolCallId: event.id,
    toolName: event.name,
    status: 'pending',
    userId: context.userId,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
    startedAt: Date.now(),
  })

  // Execute asynchronously - don't await here to avoid blocking stream
  executeToolServerSide(event, context).catch((error) => {
    logger.error('Async tool execution failed', {
      toolCallId: event.id,
      toolName: event.name,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  return true
}

/**
 * Execute a tool server-side and mark it complete.
 * This is called asynchronously from handleToolCallEvent.
 */
async function executeToolServerSide(
  event: ToolCallEvent,
  context: ExecutionContext
): Promise<void> {
  const startTime = Date.now()

  // Update state to executing
  await saveToolState({
    toolCallId: event.id,
    toolName: event.name,
    status: 'executing',
    userId: context.userId,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
    startedAt: startTime,
  })

  try {
    const result = await executeToolOnServer(event.name, event.arguments, context)

    if (!result) {
      // This shouldn't happen since we checked isServerExecutedTool
      logger.error('executeToolOnServer returned null for registered tool', {
        toolCallId: event.id,
        toolName: event.name,
      })

      await saveToolState({
        toolCallId: event.id,
        toolName: event.name,
        status: 'failed',
        userId: context.userId,
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        chatId: context.chatId,
        startedAt: startTime,
        completedAt: Date.now(),
        error: 'Internal error: tool not found',
      })

      await markToolComplete(event.id, event.name, 500, 'Internal error: tool not found')
      return
    }

    const durationMs = Date.now() - startTime

    if (result.success) {
      logger.info('Tool executed successfully', {
        toolCallId: event.id,
        toolName: event.name,
        durationMs,
      })

      await saveToolState({
        toolCallId: event.id,
        toolName: event.name,
        status: 'completed',
        userId: context.userId,
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        chatId: context.chatId,
        startedAt: startTime,
        completedAt: Date.now(),
        result: result.data,
      })

      // Mark complete with success
      await markToolComplete(
        event.id,
        event.name,
        200,
        undefined, // message
        result.data // data
      )
    } else {
      logger.warn('Tool execution failed', {
        toolCallId: event.id,
        toolName: event.name,
        durationMs,
        error: result.error,
      })

      await saveToolState({
        toolCallId: event.id,
        toolName: event.name,
        status: 'failed',
        userId: context.userId,
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        chatId: context.chatId,
        startedAt: startTime,
        completedAt: Date.now(),
        error: result.error?.message,
      })

      // Mark complete with error
      await markToolComplete(
        event.id,
        event.name,
        400,
        result.error?.message ?? 'Tool execution failed',
        result.error?.details
      )
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const message = error instanceof Error ? error.message : String(error)

    logger.error('Tool execution threw exception', {
      toolCallId: event.id,
      toolName: event.name,
      durationMs,
      error: message,
    })

    await saveToolState({
      toolCallId: event.id,
      toolName: event.name,
      status: 'failed',
      userId: context.userId,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      chatId: context.chatId,
      startedAt: startTime,
      completedAt: Date.now(),
      error: message,
    })

    // Mark complete with error
    await markToolComplete(event.id, event.name, 500, message)
  }
}

/**
 * In-memory fallback for tracking server-handled tools when Redis is unavailable.
 */
const serverHandledTools = new Map<string, { toolName: string; handledAt: number }>()

/**
 * Register a tool as being handled server-side.
 */
export function registerServerHandledTool(toolCallId: string, toolName: string): void {
  serverHandledTools.set(toolCallId, {
    toolName,
    handledAt: Date.now(),
  })

  // Clean up old entries (older than 1 hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  for (const [id, info] of serverHandledTools.entries()) {
    if (info.handledAt < oneHourAgo) {
      serverHandledTools.delete(id)
    }
  }
}

/**
 * Check if a tool was handled server-side.
 */
export async function wasToolHandledServerSide(toolCallId: string): Promise<boolean> {
  // Check in-memory first
  if (serverHandledTools.has(toolCallId)) {
    return true
  }

  // Check Redis
  const state = await getToolState(toolCallId)
  return state !== null
}

/**
 * Get the execution state of a tool.
 * Useful for client reconnection scenarios.
 */
export async function getToolExecutionState(
  toolCallId: string
): Promise<ToolExecutionState | null> {
  return getToolState(toolCallId)
}

/**
 * Get list of server-executed tool names for client reference.
 */
export { SERVER_EXECUTED_TOOLS } from './registry'
