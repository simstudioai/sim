import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { executeTool as executeAppTool } from '@/tools'
import { isKnownTool, isSimExecuted } from './router'
import type {
  ToolCallDescriptor,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
} from './types'

const logger = createLogger('ToolExecutor')

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
    const appParams = buildAppToolParams(params, context)
    return executeAppTool(toolId, appParams, false)
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

export async function executeToolBatch(
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
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Record<string, unknown> {
  const result = { ...params }

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
