/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import { getToolCallTerminalData } from '@/lib/copilot/request/tool-call-state'
import type { ToolCallState } from '@/lib/copilot/request/types'

function terminalToolCall(input: {
  status: MothershipStreamV1ToolOutcome
  output?: unknown
  error?: string
}): Pick<ToolCallState, 'id' | 'status' | 'result' | 'error'> {
  return {
    id: 'tool-call-1',
    status: input.status,
    result: Object.hasOwn(input, 'output')
      ? { success: input.status === MothershipStreamV1ToolOutcome.success, output: input.output }
      : { success: input.status === MothershipStreamV1ToolOutcome.success },
    error: input.error,
  }
}

describe('getToolCallTerminalData', () => {
  it('returns a successful output untouched', () => {
    const toolCall = terminalToolCall({
      status: MothershipStreamV1ToolOutcome.success,
      output: { files: ['a.png'] },
    })
    expect(getToolCallTerminalData(toolCall)).toEqual({ files: ['a.png'] })
  })

  it('returns undefined for a successful call without output', () => {
    const toolCall = terminalToolCall({ status: MothershipStreamV1ToolOutcome.success })
    expect(getToolCallTerminalData(toolCall)).toBeUndefined()
  })

  it('returns undefined for a skipped call without output', () => {
    const toolCall = terminalToolCall({ status: MothershipStreamV1ToolOutcome.skipped })
    expect(getToolCallTerminalData(toolCall)).toBeUndefined()
  })

  /**
   * Regression: the app-tool executor fails with a defined-but-empty output
   * (`output: {}`), and the empty object used to win over the error — the
   * model read `{}` on resume and retried blind instead of reacting to
   * "Tool not found".
   */
  it('merges the error into a failed call with an empty object output', () => {
    const toolCall = terminalToolCall({
      status: MothershipStreamV1ToolOutcome.error,
      output: {},
      error: 'Tool not found',
    })
    expect(getToolCallTerminalData(toolCall)).toEqual({ error: 'Tool not found' })
  })

  it('merges the error into a failed call with a non-empty object output', () => {
    const toolCall = terminalToolCall({
      status: MothershipStreamV1ToolOutcome.error,
      output: { partial: 'result' },
      error: 'Timed out',
    })
    expect(getToolCallTerminalData(toolCall)).toEqual({ partial: 'result', error: 'Timed out' })
  })

  it('keeps the output error field when the failed output already carries one', () => {
    const toolCall = terminalToolCall({
      status: MothershipStreamV1ToolOutcome.error,
      output: { error: 'handler-reported error' },
      error: 'outer error',
    })
    expect(getToolCallTerminalData(toolCall)).toEqual({ error: 'handler-reported error' })
  })

  it('wraps a failed non-object output alongside the error', () => {
    const toolCall = terminalToolCall({
      status: MothershipStreamV1ToolOutcome.error,
      output: 'raw text output',
      error: 'Execution failed',
    })
    expect(getToolCallTerminalData(toolCall)).toEqual({
      output: 'raw text output',
      error: 'Execution failed',
    })
  })

  it('wraps a failed array output alongside the error instead of spreading it', () => {
    const toolCall = terminalToolCall({
      status: MothershipStreamV1ToolOutcome.error,
      output: [1, 2],
      error: 'Execution failed',
    })
    expect(getToolCallTerminalData(toolCall)).toEqual({ output: [1, 2], error: 'Execution failed' })
  })

  it('substitutes a placeholder when a failed call with output has no error string', () => {
    const toolCall = terminalToolCall({
      status: MothershipStreamV1ToolOutcome.error,
      output: {},
    })
    expect(getToolCallTerminalData(toolCall)).toEqual({
      error: 'Tool failed without an error message',
    })
  })

  it('surfaces the error for failed calls without any output', () => {
    for (const status of [
      MothershipStreamV1ToolOutcome.error,
      MothershipStreamV1ToolOutcome.cancelled,
      MothershipStreamV1ToolOutcome.rejected,
    ]) {
      const toolCall = terminalToolCall({ status, error: 'It broke' })
      expect(getToolCallTerminalData(toolCall)).toEqual({ error: 'It broke' })
    }
  })
})
