/**
 * Client-side utilities for server-executed tools.
 *
 * This module helps the client know which tools are executed server-side
 * to avoid double-execution.
 */

import { createLogger } from '@sim/logger'

const logger = createLogger('ServerExecutedTools')

/**
 * List of tools that are executed server-side.
 * This is cached after the first fetch.
 */
let cachedServerExecutedTools: Set<string> | null = null

/**
 * Tools currently being executed server-side.
 * Maps toolCallId to tool info.
 */
const serverHandledToolCalls = new Map<
  string,
  {
    toolName: string
    startedAt: number
  }
>()

/**
 * Fetch the list of server-executed tools from the API.
 * Results are cached for the session.
 */
export async function fetchServerExecutedTools(): Promise<Set<string>> {
  if (cachedServerExecutedTools) {
    return cachedServerExecutedTools
  }

  try {
    const response = await fetch('/api/copilot/tools/server-executed')
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = (await response.json()) as { tools: string[] }
    cachedServerExecutedTools = new Set(data.tools)

    logger.info('Fetched server-executed tools', {
      count: cachedServerExecutedTools.size,
      tools: Array.from(cachedServerExecutedTools),
    })

    return cachedServerExecutedTools
  } catch (error) {
    logger.warn('Failed to fetch server-executed tools, using empty set', {
      error: error instanceof Error ? error.message : String(error),
    })
    // Return empty set on error - tools will execute client-side as fallback
    return new Set()
  }
}

/**
 * Check if a tool is executed server-side.
 * Uses cached list or fetches if not available.
 */
export async function isServerExecutedTool(toolName: string): Promise<boolean> {
  const serverTools = await fetchServerExecutedTools()
  return serverTools.has(toolName)
}

/**
 * Synchronous check if a tool is server-executed.
 * Returns false if cache is not yet populated.
 */
export function isServerExecutedToolSync(toolName: string): boolean {
  if (!cachedServerExecutedTools) {
    return false
  }
  return cachedServerExecutedTools.has(toolName)
}

/**
 * Get the cached list of server-executed tools.
 * Returns null if not yet fetched.
 */
export function getServerExecutedToolsSync(): Set<string> | null {
  return cachedServerExecutedTools
}

/**
 * Mark a tool call as being handled by the server.
 * Used to prevent client from executing it.
 */
export function markToolCallServerHandled(toolCallId: string, toolName: string): void {
  serverHandledToolCalls.set(toolCallId, {
    toolName,
    startedAt: Date.now(),
  })

  logger.debug('Marked tool call as server-handled', { toolCallId, toolName })

  // Cleanup old entries (older than 1 hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  for (const [id, info] of serverHandledToolCalls.entries()) {
    if (info.startedAt < oneHourAgo) {
      serverHandledToolCalls.delete(id)
    }
  }
}

/**
 * Check if a specific tool call is being handled by the server.
 */
export function isToolCallServerHandled(toolCallId: string): boolean {
  return serverHandledToolCalls.has(toolCallId)
}

/**
 * Remove a tool call from server-handled tracking.
 * Called when tool_result is received.
 */
export function clearToolCallServerHandled(toolCallId: string): void {
  serverHandledToolCalls.delete(toolCallId)
}

/**
 * Get tool execution state from the server (for reconnection scenarios).
 */
export async function getToolExecutionState(toolCallId: string): Promise<{
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'unknown'
  result?: unknown
  error?: string
} | null> {
  try {
    const response = await fetch(`/api/copilot/tools/execution-state/${toolCallId}`)
    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    logger.warn('Failed to get tool execution state', {
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Pre-fetch server-executed tools list.
 * Call this early in the app lifecycle.
 */
export function prefetchServerExecutedTools(): void {
  fetchServerExecutedTools().catch(() => {
    // Errors already logged in fetchServerExecutedTools
  })
}
