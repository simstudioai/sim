import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions } from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotClientUtils')

export function safeStringify(obj: any, maxLength: number = 1000): string {
  try {
    if (obj === undefined) return 'undefined'
    if (obj === null) return 'null'
    const str = JSON.stringify(obj)
    return str ? str.substring(0, maxLength) : 'empty'
  } catch (e) {
    return `[stringify error: ${e}]`
  }
}

export function normalizeToolCallArguments(toolCall: CopilotToolCall): CopilotToolCall {
  const extended = toolCall as CopilotToolCall & { arguments?: any }
  if (extended.arguments && !toolCall.parameters && !toolCall.input) {
    toolCall.input = extended.arguments
    toolCall.parameters = extended.arguments
    logger.info('Mapped arguments to input/parameters', {
      toolCallId: toolCall.id,
      argumentsPreview: safeStringify(extended.arguments, 400),
    })
  }
  return toolCall
}

export function getProvidedParams(toolCall: CopilotToolCall): any {
  const extended = toolCall as CopilotToolCall & { arguments?: any }
  return toolCall.parameters || toolCall.input || extended.arguments || {}
}

export async function postToMethods(
  methodId: string,
  params: Record<string, any>,
  toolIdentifiers: { toolCallId?: string | null; toolId?: string | null },
  options?: ToolExecutionOptions
): Promise<ToolExecuteResult> {
  try {
    options?.onStateChange?.('executing')

    const requestBody = {
      methodId,
      params,
      toolCallId: toolIdentifiers.toolCallId ?? null,
      toolId: toolIdentifiers.toolId ?? toolIdentifiers.toolCallId ?? null,
    }

    logger.info('Sending request to methods route', {
      methodId,
      body: safeStringify(requestBody, 1000),
    })

    const response = await fetch('/api/copilot/methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(requestBody),
    })

    logger.info('Methods route response received', { ok: response.ok, status: response.status })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      options?.onStateChange?.('errored')
      return { success: false, error: (errorData as any)?.error || 'Failed to execute server method' }
    }

    const result = await response.json()
    if (!result?.success) {
      options?.onStateChange?.('errored')
      return { success: false, error: result?.error || 'Server method execution failed' }
    }

    options?.onStateChange?.('success')
    return { success: true, data: result.data }
  } catch (error: any) {
    options?.onStateChange?.('errored')
    return { success: false, error: error?.message || 'Unexpected error while calling methods route' }
  }
} 