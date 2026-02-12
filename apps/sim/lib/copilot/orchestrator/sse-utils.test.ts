/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeSseEvent,
  shouldSkipToolCallEvent,
  shouldSkipToolResultEvent,
} from '@/lib/copilot/orchestrator/sse-utils'

describe('sse-utils', () => {
  it.concurrent('normalizes tool fields from string data', () => {
    const event = {
      type: 'tool_result',
      data: JSON.stringify({
        id: 'tool_1',
        name: 'workflow_change',
        success: true,
        result: { ok: true },
      }),
    }

    const normalized = normalizeSseEvent(event as any)

    expect(normalized.toolCallId).toBe('tool_1')
    expect(normalized.toolName).toBe('workflow_change')
    expect(normalized.success).toBe(true)
    expect(normalized.result).toEqual({ ok: true })
  })

  it.concurrent('dedupes tool_call events', () => {
    const event = { type: 'tool_call', data: { id: 'tool_call_1', name: 'plan' } }
    expect(shouldSkipToolCallEvent(event as any)).toBe(false)
    expect(shouldSkipToolCallEvent(event as any)).toBe(true)
  })

  it.concurrent('dedupes tool_result events', () => {
    const event = { type: 'tool_result', data: { id: 'tool_result_1', name: 'plan' } }
    expect(shouldSkipToolResultEvent(event as any)).toBe(false)
    expect(shouldSkipToolResultEvent(event as any)).toBe(true)
  })
})
