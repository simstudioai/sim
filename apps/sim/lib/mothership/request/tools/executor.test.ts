import '@sim/testing/mocks/executor'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  executeTool,
  completeAsyncToolCall,
  markAsyncToolRunning,
  upsertAsyncToolCall,
  onEvent,
  recordSimToolMetric,
  setAttribute,
  withCopilotToolSpan,
} = vi.hoisted(() => {
  const setAttribute = vi.fn()
  return {
    executeTool: vi.fn(),
    completeAsyncToolCall: vi.fn(),
    markAsyncToolRunning: vi.fn(),
    upsertAsyncToolCall: vi.fn(),
    onEvent: vi.fn(),
    recordSimToolMetric: vi.fn(),
    setAttribute,
    withCopilotToolSpan: vi.fn(
      (_input: unknown, fn: (span: { setAttribute: typeof setAttribute }) => Promise<unknown>) =>
        fn({ setAttribute })
    ),
  }
})

vi.mock('@/lib/mothership/tool-executor', () => ({
  ensureHandlersRegistered: vi.fn(),
  executeTool,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  completeAsyncToolCall,
  markAsyncToolRunning,
  upsertAsyncToolCall,
}))

vi.mock('@/lib/mothership/persistence/tool-confirm', () => ({
  publishToolConfirmation: vi.fn(),
}))

vi.mock('@/lib/mothership/request/metrics', () => ({
  recordSimToolMetric,
}))

vi.mock('@/lib/mothership/request/otel', () => ({
  withCopilotToolSpan,
}))

vi.mock('@/lib/mothership/request/sse-utils', () => ({
  markToolResultSeen: vi.fn(),
}))

vi.mock('@/lib/mothership/request/tools/files', () => ({
  maybeWriteOutputToFile: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/mothership/request/tools/resources', () => ({
  handleResourceSideEffects: vi.fn(),
}))

vi.mock('@/lib/mothership/request/tools/tables', () => ({
  maybeWriteOutputToTable: vi.fn(async (_toolName, _params, result) => result),
  maybeWriteReadCsvToTable: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/mothership/request/tools/workflow-context', () => ({
  applyCreateWorkflowOutputToContext: vi.fn(),
}))

import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/mothership/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { GenerateApiKey } from '@/lib/mothership/generated/tool-catalog-v1'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import {
  buildToolExecutionContext,
  executeToolAndReport,
  pendingToolWaitBudgetMs,
  toolWatchdogTimeoutMs,
} from '@/lib/mothership/request/tools/executor'
import type { ExecutionContext, ToolCallState } from '@/lib/mothership/request/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function buildStreamingContext(toolCall: ToolCallState) {
  return createStreamingContext({
    runId: 'run-1',
    messageId: 'message-1',
    toolCalls: new Map([[toolCall.id, toolCall]]),
  })
}

function buildPendingToolCall(): ToolCallState {
  return {
    id: 'tool-call-1',
    name: 'test_tool',
    status: 'pending',
    params: {},
  }
}

describe('toolWatchdogTimeoutMs', () => {
  it('gives request-scoped MCP tools the long-running watchdog', () => {
    expect(toolWatchdogTimeoutMs('mcp-363de040-web_search_exa')).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
  })

  it('keeps ordinary tools on the strict default watchdog', () => {
    expect(toolWatchdogTimeoutMs('read')).toBe(TOOL_WATCHDOG_DEFAULT_MS)
  })

  it.each(['deploy_as_api', 'deploy_as_chat', 'deploy_as_mcp', 'redeploy', 'promote_to_live'])(
    'does not undercut deployment tool %s with the default watchdog',
    (toolName) => {
      expect(toolWatchdogTimeoutMs(toolName)).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
    }
  )
})

describe('pendingToolWaitBudgetMs', () => {
  it('bounds retired browser calls that can no longer be executed by the client', () => {
    expect(pendingToolWaitBudgetMs({ name: 'browser_request_takeover', status: 'executing' })).toBe(
      TOOL_WATCHDOG_DEFAULT_MS
    )
  })

  it('waits on a person for as long as the whole turn allows', () => {
    // The 60s default would force-fail a permission prompt while the user was
    // still reading it, resuming Go before they ever answered.
    expect(pendingToolWaitBudgetMs({ name: 'terminal_run', status: 'awaiting_approval' })).toBe(
      TOOL_WATCHDOG_LONG_RUNNING_MS
    )
  })

  it('matches the requested browser_wait_for renderer budget', () => {
    expect(pendingToolWaitBudgetMs({ name: 'browser_wait_for', status: 'executing' })).toBe(25_000)
    expect(
      pendingToolWaitBudgetMs({
        name: 'browser_wait_for',
        status: 'executing',
        params: { timeoutMs: 120_000 },
      })
    ).toBe(135_000)
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
      sandboxProfile: 'mothership',
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
      sandboxProfile: 'mothership',
      toolCallId: 'call-1',
      parentToolCallId: 'parent-1',
    })
  })

  it('isolates one tool from a sibling secret activation and merges settled provenance', () => {
    const parentRegistry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secretvalue', encryptedValue: 'encrypted-secret' },
    ])
    const completeSiblingActivation = parentRegistry.beginPendingActivation()
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      resolvedSecretTraceRegistry: parentRegistry,
    }

    const toolContext = buildToolExecutionContext({ id: 'call-1' }, executionContext)
    const toolRegistry = toolContext.resolvedSecretTraceRegistry

    expect(toolRegistry).not.toBe(parentRegistry)
    expect(toolRegistry?.isComplete()).toBe(true)
    expect(toolRegistry?.recordResolved('TOKEN', 'secretvalue')).toBe(true)
    parentRegistry.mergeToolCallRegistry(toolRegistry!)
    completeSiblingActivation()
    expect(parentRegistry.getActiveMatches()).toEqual([
      { plaintext: 'secretvalue', replacement: '{{TOKEN}}' },
    ])
  })
})

describe('executeToolAndReport provenance isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    completeAsyncToolCall.mockResolvedValue(null)
    markAsyncToolRunning.mockResolvedValue(null)
    upsertAsyncToolCall.mockResolvedValue(null)
  })

  it('merges a complete child only after its projected result is safe', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.recordResolved('TOKEN', 'secret-value', {
          propagated: true,
        })
        return { success: true, output: { value: 'secret-value' } }
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      { userId: 'user-1', workflowId: 'workflow-1', resolvedSecretTraceRegistry: registry },
      { onEvent }
    )

    expect(completion).toEqual({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      data: { value: '{{TOKEN}}' },
    })
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{TOKEN}}' },
    ])
  })

  it('structurally omits an incomplete result without poisoning the parent turn', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.markIncomplete('unspecified')
        return { success: true, output: { value: 'secret-value' } }
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      { userId: 'user-1', workflowId: 'workflow-1', resolvedSecretTraceRegistry: registry },
      { onEvent }
    )

    expect(completion).toEqual({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      data: { success: true },
    })
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify([completion, onEvent.mock.calls])).not.toContain('secret-value')
  })

  it('structurally fails an incomplete thrown error without poisoning the parent turn', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.markIncomplete('unspecified')
        throw new Error('secret-value')
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      { userId: 'user-1', workflowId: 'workflow-1', resolvedSecretTraceRegistry: registry },
      { onEvent }
    )

    expect(completion.status).toBe(MothershipStreamV1ToolOutcome.error)
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify([completion, onEvent.mock.calls])).not.toContain('secret-value')
  })

  it('discards an incomplete child when execution is aborted before result delivery', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    const abortController = new AbortController()
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.markIncomplete('unspecified')
        abortController.abort()
        return { success: true, output: { value: 'secret-value' } }
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        abortSignal: abortController.signal,
        resolvedSecretTraceRegistry: registry,
      },
      { onEvent }
    )

    expect(completion.status).toBe(MothershipStreamV1ToolOutcome.cancelled)
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify([completion, onEvent.mock.calls])).not.toContain('secret-value')
  })

  it('reveals a generated API key only in the live client event', async () => {
    const generatedKey = 'sk-sim-one-time-secret'
    const statusMessage = 'API key "streaming-test" created.'
    executeTool.mockResolvedValueOnce({
      success: true,
      output: {
        id: 'key-1',
        name: 'streaming-test',
        key: generatedKey,
        workspaceId: 'workspace-1',
        message: statusMessage,
      },
    })
    const toolCall: ToolCallState = {
      id: 'generate-key-call',
      name: GenerateApiKey.id,
      status: 'pending',
      params: { name: 'streaming-test' },
    }

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      },
      { onEvent }
    )

    expect(completion).toEqual({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      data: statusMessage,
    })
    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ result: statusMessage })
    )
    expect(JSON.stringify([completion, completeAsyncToolCall.mock.calls])).not.toContain(
      generatedKey
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolName: GenerateApiKey.id,
          phase: MothershipStreamV1ToolPhase.result,
          success: true,
          output: expect.objectContaining({ key: generatedKey }),
        }),
      })
    )
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
    expect(withCopilotToolSpan).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: 'workflow' }),
      expect.any(Function)
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
      expect(withCopilotToolSpan).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: expectedAgentId }),
        expect.any(Function)
      )
    }
  )
})
