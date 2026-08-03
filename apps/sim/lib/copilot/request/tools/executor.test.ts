import '@sim/testing/mocks/executor'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recordSimToolMetric, setAttribute } = vi.hoisted(() => ({
  recordSimToolMetric: vi.fn(),
  setAttribute: vi.fn(),
}))

vi.mock('@/lib/copilot/request/metrics', () => ({
  recordSimToolMetric,
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotToolSpan: (
    _input: unknown,
    fn: (span: { setAttribute: typeof setAttribute }) => Promise<unknown>
  ) => fn({ setAttribute }),
}))

import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/copilot/constants'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import {
  buildToolExecutionContext,
  executeToolAndReport,
  pendingToolWaitBudgetMs,
  toolWatchdogTimeoutMs,
} from '@/lib/copilot/request/tools/executor'
import type { ExecutionContext, ToolCallState } from '@/lib/copilot/request/types'

describe('toolWatchdogTimeoutMs', () => {
  it('gives request-scoped MCP tools the long-running watchdog', () => {
    expect(toolWatchdogTimeoutMs('mcp-363de040-web_search_exa')).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
  })

  it('keeps ordinary tools on the strict default watchdog', () => {
    expect(toolWatchdogTimeoutMs('read')).toBe(TOOL_WATCHDOG_DEFAULT_MS)
  })
})

describe('pendingToolWaitBudgetMs', () => {
  it('waits on a person for as long as the whole turn allows', () => {
    // The 60s default would force-fail a permission prompt while the user was
    // still reading it, resuming Go before they ever answered.
    expect(pendingToolWaitBudgetMs({ name: 'terminal_run', status: 'awaiting_approval' })).toBe(
      TOOL_WATCHDOG_LONG_RUNNING_MS
    )
  })

  it('falls back to the tool\u2019s own watchdog once it is actually executing', () => {
    expect(pendingToolWaitBudgetMs({ name: 'terminal_run', status: 'executing' })).toBe(
      TOOL_WATCHDOG_DEFAULT_MS
    )
  })
})

describe('buildToolExecutionContext', () => {
  it('threads logical tool-call identity into the handler context', () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      runId: 'run-1',
    }

    expect(
      buildToolExecutionContext(
        {
          id: 'call-1',
          parentToolCallId: 'parent-1',
        },
        executionContext
      )
    ).toMatchObject({
      runId: 'run-1',
      toolCallId: 'call-1',
      parentToolCallId: 'parent-1',
    })
  })
})

describe('executeToolAndReport metrics', () => {
  const executionContext: ExecutionContext = {
    userId: 'user-1',
    workflowId: 'workflow-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the stored agent on normal completion', async () => {
    const toolCall: ToolCallState = {
      id: 'call-1',
      name: 'read',
      status: MothershipStreamV1ToolOutcome.success,
      result: { success: true, output: 'done' },
      agentId: 'workflow',
      endTime: Date.now(),
    }
    const context = createStreamingContext({
      toolCalls: new Map([[toolCall.id, toolCall]]),
    })

    await executeToolAndReport(toolCall.id, context, executionContext)

    expect(recordSimToolMetric).toHaveBeenCalledWith(
      'read',
      'workflow',
      MothershipStreamV1ToolOutcome.success,
      expect.any(Number)
    )
  })

  it.each([
    { agentId: 'workflow', expectedAgentId: 'workflow' },
    { agentId: undefined, expectedAgentId: 'main' },
  ])(
    'forwards $expectedAgentId when an unexpected error occurs',
    async ({ agentId, expectedAgentId }) => {
      const toolCall: ToolCallState = {
        id: 'call-2',
        name: 'read',
        status: MothershipStreamV1ToolOutcome.error,
        agentId,
        endTime: Date.now(),
      }
      const context = createStreamingContext({
        toolCalls: new Map([[toolCall.id, toolCall]]),
      })

      await expect(executeToolAndReport(toolCall.id, context, executionContext)).rejects.toThrow(
        'missing a canonical error'
      )
      expect(recordSimToolMetric).toHaveBeenCalledWith(
        'read',
        expectedAgentId,
        MothershipStreamV1ToolOutcome.error,
        expect.any(Number)
      )
    }
  )
})
