/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toolCallsAdd, toolDurationRecord } = vi.hoisted(() => ({
  toolCallsAdd: vi.fn(),
  toolDurationRecord: vi.fn(),
}))

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(() => ({
      createCounter: vi.fn(() => ({ add: toolCallsAdd })),
      createHistogram: vi.fn((name: string) => ({
        record: name === 'copilot.tool.duration' ? toolDurationRecord : vi.fn(),
      })),
    })),
  },
}))

import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { normalizeToolAgentId, recordSimToolMetric } from '@/lib/copilot/request/metrics'

describe('recordSimToolMetric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['main', 'workflow'])(
    'attributes call counts and duration to the registered %s agent',
    (agentId) => {
      recordSimToolMetric('read', agentId, 'success', 125)

      const baseAttributes = {
        [TraceAttr.ToolName]: 'read',
        [TraceAttr.ToolExecutor]: 'sim',
        [TraceAttr.ToolOutcome]: 'success',
      }
      expect(toolCallsAdd).toHaveBeenCalledWith(1, {
        ...baseAttributes,
        [TraceAttr.GenAiAgentName]: agentId,
      })
      expect(toolDurationRecord).toHaveBeenCalledWith(125, {
        ...baseAttributes,
        [TraceAttr.GenAiAgentName]: agentId,
      })
    }
  )

  it('collapses unknown agent IDs to the bounded fallback', () => {
    recordSimToolMetric('read', 'tenant-defined-agent', 'success', 125)

    const baseAttributes = {
      [TraceAttr.ToolName]: 'read',
      [TraceAttr.ToolExecutor]: 'sim',
      [TraceAttr.ToolOutcome]: 'success',
    }
    expect(toolCallsAdd).toHaveBeenCalledWith(1, {
      ...baseAttributes,
      [TraceAttr.GenAiAgentName]: 'other',
    })
    expect(toolDurationRecord).toHaveBeenCalledWith(125, {
      ...baseAttributes,
      [TraceAttr.GenAiAgentName]: 'other',
    })
  })

  it.each([
    { agentId: 'main', expected: 'main' },
    { agentId: 'workflow', expected: 'workflow' },
    { agentId: 'tenant-defined-agent', expected: 'other' },
    { agentId: '', expected: 'other' },
  ])('normalizes $agentId to $expected for every telemetry signal', ({ agentId, expected }) => {
    expect(normalizeToolAgentId(agentId)).toBe(expected)
  })
})
