import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { executeTool as executeAppTool } from '@/tools'
import { isKnownTool, isSimExecuted } from './router'
import type {
  ToolCallDescriptor,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
} from './types'

const logger = createLogger('ToolExecutor')
const FUNCTION_EXECUTE_TOOL_ID = 'function_execute'
const DEFAULT_FUNCTION_EXECUTE_TIMEOUT_SECONDS = 10
const MILLISECONDS_PER_SECOND = 1000

const handlerRegistry = new Map<string, ToolHandler>()

export function registerHandler(toolId: string, handler: ToolHandler): void {
  handlerRegistry.set(toolId, handler)
}

export function registerHandlers(entries: Record<string, ToolHandler>): void {
  for (const [toolId, handler] of Object.entries(entries)) {
    handlerRegistry.set(toolId, handler)
  }
}

export function getRegisteredToolIds(): string[] {
  return Array.from(handlerRegistry.keys())
}

export function hasHandler(toolId: string): boolean {
  return handlerRegistry.has(toolId)
}

export async function executeTool(
  toolId: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const canUseRegisteredHandler = isKnownTool(toolId) && isSimExecuted(toolId)
  if (!canUseRegisteredHandler) {
    const appParams = buildAppToolParams(toolId, params, context)
    return executeAppTool(toolId, appParams)
  }

  if (context.abortSignal?.aborted) {
    logger.warn('Tool execution skipped: abort signal already set', {
      toolId,
      abortReason: context.abortSignal.reason ?? 'unknown',
    })
    return { success: false, error: 'Execution aborted: abort signal was set before tool started' }
  }

  const handler = handlerRegistry.get(toolId)
  if (!handler) {
    logger.warn('No handler registered for tool', { toolId })
    return { success: false, error: `No handler for tool: ${toolId}` }
  }

  try {
    return await handler(params, context)
  } catch (error) {
    const message = toError(error).message
    logger.error('Tool execution failed', {
      toolId,
      error: message,
      abortSignalAborted: context.abortSignal?.aborted ?? false,
    })
    return { success: false, error: message }
  }
}

async function executeToolBatch(
  toolCalls: ToolCallDescriptor[],
  context: ToolExecutionContext
): Promise<Map<string, ToolExecutionResult>> {
  const results = new Map<string, ToolExecutionResult>()

  const executions = toolCalls.map(async ({ toolCallId, toolId, params }) => {
    const result = await executeTool(toolId, params, context)
    results.set(toolCallId, result)
  })

  await Promise.allSettled(executions)

  for (const { toolCallId } of toolCalls) {
    if (!results.has(toolCallId)) {
      results.set(toolCallId, {
        success: false,
        error: 'Tool execution did not produce a result',
      })
    }
  }

  return results
}

function buildAppToolParams(
  toolId: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Record<string, unknown> {
  const result = { ...params }

  if (toolId === FUNCTION_EXECUTE_TOOL_ID && context.copilotToolExecution) {
    const rawTimeoutSeconds =
      result.timeout === undefined || result.timeout === null
        ? DEFAULT_FUNCTION_EXECUTE_TIMEOUT_SECONDS
        : Number(result.timeout)
    const timeoutSeconds =
      Number.isFinite(rawTimeoutSeconds) && rawTimeoutSeconds > 0
        ? rawTimeoutSeconds
        : DEFAULT_FUNCTION_EXECUTE_TIMEOUT_SECONDS
    result.timeout = Math.min(
      Math.ceil(timeoutSeconds * MILLISECONDS_PER_SECOND),
      DEFAULT_EXECUTION_TIMEOUT_MS
    )
  }

  if (result.credentialId && !result.credential && !result.oauthCredential) {
    result.credential = result.credentialId
  }

  result._context = {
    ...(typeof result._context === 'object' && result._context !== null
      ? (result._context as object)
      : {}),
    userId: context.userId,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
    executionId: context.executionId,
    runId: context.runId,
    copilotToolExecution: context.copilotToolExecution,
    requestMode: context.requestMode,
    currentAgentId: context.currentAgentId,
    enforceCredentialAccess: true,
  }

  return result
}
