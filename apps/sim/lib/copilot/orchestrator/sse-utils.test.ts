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
      type: 'copilot.tool.result',
      data: JSON.stringify({
        id: 'tool_1',
        name: 'workflow_change',
        success: true,
        result: { ok: true },
      }),
    }

    const normalized = normalizeSseEvent(event as any)

    expect(normalized.type).toBe('copilot.tool.result')
    expect(normalized.toolCallId).toBe('tool_1')
    expect(normalized.toolName).toBe('workflow_change')
    expect(normalized.success).toBe(true)
    expect(normalized.result).toEqual({ ok: true })
  })

  it.concurrent('maps copilot tool event aliases and preserves tool metadata', () => {
    const event = {
      type: 'copilot.tool.interrupt_required',
      data: {
        id: 'tool_legacy_1',
        name: 'workflow_run',
        state: 'pending',
        ui: { showInterrupt: true },
      },
    }

    const normalized = normalizeSseEvent(event as any)

    expect(normalized.type).toBe('copilot.tool.interrupt_required')
    expect(normalized.toolCallId).toBe('tool_legacy_1')
    expect(normalized.toolName).toBe('workflow_run')
  })

  it.concurrent('keeps copilot content event type when payload is plain string', () => {
    const event = {
      type: 'copilot.content',
      data: 'hello world',
    }

    const normalized = normalizeSseEvent(event as any)

    expect(normalized.type).toBe('copilot.content')
    expect(normalized.data).toBe('hello world')
  })

  it.concurrent('dedupes copilot tool call events', () => {
    const event = { type: 'copilot.tool.call', data: { id: 'tool_call_1', name: 'plan' } }
    expect(shouldSkipToolCallEvent(event as any)).toBe(false)
    expect(shouldSkipToolCallEvent(event as any)).toBe(true)
  })

  it.concurrent('dedupes copilot tool result events', () => {
    const event = { type: 'copilot.tool.result', data: { id: 'tool_result_1', name: 'plan' } }
    expect(shouldSkipToolResultEvent(event as any)).toBe(false)
    expect(shouldSkipToolResultEvent(event as any)).toBe(true)
  })

  it.concurrent('dedupes copilot workflow patch result events', () => {
    const normalized = normalizeSseEvent({
      type: 'copilot.workflow.patch',
      data: { id: 'tool_result_aliased_1', name: 'workflow_change' },
    } as any)

    expect(shouldSkipToolResultEvent(normalized as any)).toBe(false)
    expect(shouldSkipToolResultEvent(normalized as any)).toBe(true)
  })
})
