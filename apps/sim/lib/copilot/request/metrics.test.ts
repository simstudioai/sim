/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

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
import { recordSimToolMetric } from '@/lib/copilot/request/metrics'

describe('recordSimToolMetric', () => {
  it('attributes call counts to the agent without adding it to duration', () => {
    recordSimToolMetric('read', 'workflow', 'success', 125)

    const baseAttributes = {
      [TraceAttr.ToolName]: 'read',
      [TraceAttr.ToolExecutor]: 'sim',
      [TraceAttr.ToolOutcome]: 'success',
    }
    expect(toolCallsAdd).toHaveBeenCalledWith(1, {
      ...baseAttributes,
      [TraceAttr.GenAiAgentName]: 'workflow',
    })
    expect(toolDurationRecord).toHaveBeenCalledWith(125, baseAttributes)
  })
})
