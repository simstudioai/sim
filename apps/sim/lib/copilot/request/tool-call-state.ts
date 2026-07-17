import {
  MothershipStreamV1ToolOutcome,
  type MothershipStreamV1ToolOutcome as TerminalToolCallStatus,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { ToolCallState, ToolCallStateResult } from '@/lib/copilot/request/types'

function hasOwnOutput(value: { output?: unknown }): value is { output: unknown } {
  return Object.hasOwn(value, 'output')
}

export function isSuccessfulToolCallStatus(status: TerminalToolCallStatus): boolean {
  return (
    status === MothershipStreamV1ToolOutcome.success ||
    status === MothershipStreamV1ToolOutcome.skipped
  )
}

export function createToolCallStateResult(input: {
  success: boolean
  output?: unknown
}): ToolCallStateResult {
  return hasOwnOutput(input)
    ? { success: input.success, output: input.output }
    : { success: input.success }
}

export function getToolCallStateOutput(toolCall: Pick<ToolCallState, 'result'>): unknown {
  if (!toolCall.result || !hasOwnOutput(toolCall.result)) {
    return undefined
  }

  return toolCall.result.output
}

export function requireToolCallStateResult(
  toolCall: Pick<ToolCallState, 'id' | 'status' | 'result'>
): ToolCallStateResult {
  if (toolCall.result) {
    return toolCall.result
  }

  throw new Error(
    `Terminal tool call ${toolCall.id} is missing a canonical result for status ${toolCall.status}`
  )
}

export function requireToolCallError(
  toolCall: Pick<ToolCallState, 'id' | 'status' | 'error'>
): string {
  if (typeof toolCall.error === 'string' && toolCall.error.length > 0) {
    return toolCall.error
  }

  throw new Error(
    `Terminal tool call ${toolCall.id} is missing a canonical error for status ${toolCall.status}`
  )
}

export function getToolCallTerminalData(
  toolCall: Pick<ToolCallState, 'id' | 'status' | 'result' | 'error'>
): unknown {
  const output = getToolCallStateOutput(toolCall)
  if (output !== undefined) {
    return output
  }

  if (
    toolCall.status === MothershipStreamV1ToolOutcome.success ||
    toolCall.status === MothershipStreamV1ToolOutcome.skipped
  ) {
    return undefined
  }

  return { error: requireToolCallError(toolCall) }
}

export function setTerminalToolCallState(
  toolCall: ToolCallState,
  input: {
    status: TerminalToolCallStatus
    output?: unknown
    error?: string
    endTime?: number
  }
): void {
  const success = isSuccessfulToolCallStatus(input.status)
  toolCall.status = input.status
  toolCall.endTime = input.endTime ?? Date.now()
  toolCall.result = createToolCallStateResult({
    success,
    ...(Object.hasOwn(input, 'output') ? { output: input.output } : {}),
  })

  if (success) {
    toolCall.error = undefined
    return
  }

  toolCall.error = requireToolCallError({
    id: toolCall.id,
    status: input.status,
    error: input.error,
  })
}
