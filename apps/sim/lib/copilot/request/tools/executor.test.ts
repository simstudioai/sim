/**
 * @vitest-environment node
 */
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
  encryptSecret,
  decryptSecret,
  publishToolConfirmation,
  waitForToolConfirmation,
  replaceTerminalAsyncToolCallResult,
  mockError,
} = vi.hoisted(() => {
  const setAttribute = vi.fn()
  return {
    executeTool: vi.fn(),
    encryptSecret: vi.fn(),
    decryptSecret: vi.fn(),
    publishToolConfirmation: vi.fn(),
    waitForToolConfirmation: vi.fn(),
    replaceTerminalAsyncToolCallResult: vi.fn(),
    mockError: vi.fn(),
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

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mockError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret, decryptSecret }))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getTrustedWorkflowToolExecution: vi.fn(),
}))

vi.mock('@/lib/copilot/tool-executor', () => ({
  ensureHandlersRegistered: vi.fn(),
  executeTool,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  completeAsyncToolCall,
  markAsyncToolRunning,
  upsertAsyncToolCall,
  replaceTerminalAsyncToolCallResult,
}))

vi.mock('@/lib/copilot/persistence/tool-confirm', () => ({
  publishToolConfirmation,
  waitForToolConfirmation,
}))

vi.mock('@/lib/copilot/request/metrics', () => ({
  recordSimToolMetric,
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotToolSpan,
}))

vi.mock('@/lib/copilot/request/sse-utils', () => ({
  markToolResultSeen: vi.fn(),
}))

vi.mock('@/lib/copilot/request/tools/files', () => ({
  maybeWriteOutputToFile: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/copilot/request/tools/resources', () => ({
  handleResourceSideEffects: vi.fn(),
}))

vi.mock('@/lib/copilot/request/tools/tables', () => ({
  maybeWriteOutputToTable: vi.fn(async (_toolName, _params, result) => result),
  maybeWriteReadCsvToTable: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/copilot/request/tools/workflow-context', () => ({
  applyCreateWorkflowOutputToContext: vi.fn(),
}))

import { AsyncToolCallOwnershipError } from '@/lib/copilot/async-runs/errors'
import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { GenerateApiKey } from '@/lib/copilot/generated/tool-catalog-v1'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { handleClientCompletion } from '@/lib/copilot/request/handlers/types'
import { waitForClientToolCompletion } from '@/lib/copilot/request/tools/client'
import {
  sealClientToolCompletion,
  sealClientToolContext,
} from '@/lib/copilot/request/tools/client-completion-seal.server'
import {
  buildToolExecutionContext,
  executeToolAndReport,
  forceFailHungToolCall,
  pendingToolWaitBudgetMs,
  toolWatchdogTimeoutMs,
} from '@/lib/copilot/request/tools/executor'
import { maybeWriteOutputToFile } from '@/lib/copilot/request/tools/files'
import {
  maybeWriteOutputToTable,
  maybeWriteReadCsvToTable,
} from '@/lib/copilot/request/tools/tables'
import type { ExecutionContext, ToolCallState } from '@/lib/copilot/request/types'
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
    expect(pendingToolWaitBudgetMs({ name: 'browser_wait_for', status: 'executing' })).toBe(85_000)
    expect(
      pendingToolWaitBudgetMs({
        name: 'browser_wait_for',
        status: 'executing',
        params: { timeoutMs: 120_000 },
      })
    ).toBe(195_000)
  })

  it.each([
    'browser_navigate',
    'browser_open_url',
    'browser_go_back',
    'browser_go_forward',
    'browser_reload',
    'browser_open_tab',
    'browser_switch_tab',
  ])('includes authorization, queueing, and navigation in the %s budget', (name) => {
    expect(pendingToolWaitBudgetMs({ name, status: 'executing' })).toBe(130_000)
  })

  it.each(['browser_snapshot', 'browser_find', 'browser_set_checked', 'browser_click'])(
    'allows the renderer queue budget for %s',
    (name) => {
      expect(pendingToolWaitBudgetMs({ name, status: 'executing' })).toBe(90_000)
    }
  )

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

  it('does not execute or mutate a tool row owned by another run', async () => {
    const toolCall = buildPendingToolCall()
    const conflict = new AsyncToolCallOwnershipError()
    upsertAsyncToolCall.mockRejectedValueOnce(conflict)

    await expect(
      executeToolAndReport(toolCall.id, buildStreamingContext(toolCall), { userId: 'user-1' })
    ).rejects.toBe(conflict)

    expect(markAsyncToolRunning).not.toHaveBeenCalled()
    expect(executeTool).not.toHaveBeenCalled()
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

describe('watchdog completion provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptSecret.mockImplementation(async (plaintext: string) => ({ encrypted: plaintext }))
    decryptSecret.mockImplementation(async (encrypted: string) => ({ decrypted: encrypted }))
    completeAsyncToolCall.mockImplementation(async (input) => ({ ...input }))
    replaceTerminalAsyncToolCallResult.mockImplementation(async (input) => ({ ...input }))
  })

  function createHungClient() {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'private-command-token', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'private-command-token')
    const toolCall: ToolCallState = {
      id: 'terminal-call',
      name: 'terminal_run',
      status: 'executing',
      params: { command: 'private-command-token' },
    }
    const context = buildStreamingContext(toolCall)
    const execContext: ExecutionContext = {
      userId: 'user-1',
      resolvedSecretTraceRegistry: registry,
    }
    return { registry, toolCall, context, execContext }
  }

  it('restores a trusted timeout through the real sealed client completion reader', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    const finishSiblingActivation = registry.beginPendingActivation()

    await forceFailHungToolCall(toolCall.id, context, execContext)
    const persisted = completeAsyncToolCall.mock.calls[0][0]
    expect(persisted.result).toEqual({
      __sealedClientToolCompletionV1: expect.any(String),
      __sealedClientToolContextV1: expect.any(String),
    })
    waitForToolConfirmation.mockResolvedValue({
      status: 'error',
      message: persisted.error,
      data: persisted.result,
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: toolCall.id,
      runId: context.runId,
      userId: execContext.userId,
      timeoutMs: 1,
      registry,
    })
    finishSiblingActivation()

    expect(completion).toEqual({
      status: 'error',
      message: expect.stringContaining('outcome is unknown'),
      data: {
        error: expect.stringContaining('hung'),
        outcomeUnknown: true,
        doNotRetry: true,
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(mockError).not.toHaveBeenCalledWith(
      'Client tool provenance could not be restored',
      expect.anything()
    )
    expect(
      JSON.stringify([persisted, publishToolConfirmation.mock.calls, completion])
    ).not.toContain('private-command-token')
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ data: persisted.result })
    )
  })

  it('preserves an actual completion that settles while encryption is pending', async () => {
    const { toolCall, context, execContext } = createHungClient()
    let finishEncryption: (value: { encrypted: string }) => void = () => {}
    encryptSecret.mockImplementationOnce(
      () =>
        new Promise<{ encrypted: string }>((resolve) => {
          finishEncryption = resolve
        })
    )
    const settlement = forceFailHungToolCall(toolCall.id, context, execContext)
    toolCall.status = 'success'
    toolCall.endTime = Date.now()
    toolCall.result = { success: true, output: 'actual completion' }
    finishEncryption({ encrypted: 'unused' })
    await settlement

    expect(toolCall.result).toEqual({ success: true, output: 'actual completion' })
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('does not publish or overwrite an actual completion that wins the durable race', async () => {
    const { toolCall, context, execContext } = createHungClient()
    completeAsyncToolCall.mockImplementationOnce(async () => {
      toolCall.status = 'success'
      toolCall.endTime = Date.now()
      toolCall.result = { success: true, output: 'actual completion' }
      return null
    })

    await forceFailHungToolCall(toolCall.id, context, execContext)

    expect(toolCall.status).toBe('success')
    expect(toolCall.result).toEqual({ success: true, output: 'actual completion' })
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('reports unavailable output locally when the durable winner has no settled live result', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    completeAsyncToolCall.mockResolvedValueOnce(null)

    await forceFailHungToolCall(toolCall.id, context, execContext)

    expect(toolCall.status).toBe('error')
    expect(toolCall.error).toContain('result could not be restored')
    expect(toolCall.result).toEqual({
      success: false,
      output: { error: toolCall.error, outcomeUnknown: true, doNotRetry: true },
    })
    expect(publishToolConfirmation).not.toHaveBeenCalled()
    expect(registry.isComplete()).toBe(true)
  })

  it('allows the valid winning client completion to replace a local unavailable-result fallback', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    completeAsyncToolCall.mockResolvedValueOnce(null)
    await forceFailHungToolCall(toolCall.id, context, execContext)
    expect(toolCall.status).toBe('error')
    const binding = { toolCallId: toolCall.id, runId: 'run-1', userId: execContext.userId }
    waitForToolConfirmation.mockResolvedValueOnce({
      status: 'success',
      data: {
        ...(await sealClientToolContext({ ...binding, registry, toolInput: undefined })),
        ...(await sealClientToolCompletion({
          ...binding,
          message: 'Tool completed',
          data: { exitCode: 0, output: 'successful output' },
        })),
      },
    })
    const completion = await waitForClientToolCompletion({
      ...binding,
      registry,
      timeoutMs: 1,
    })
    handleClientCompletion(toolCall, toolCall.id, completion)

    expect(toolCall.status).toBe('success')
    expect(toolCall.result).toEqual({
      success: true,
      output: { exitCode: 0, output: 'successful output' },
    })
    expect(registry.isComplete()).toBe(true)
    expect(publishToolConfirmation).not.toHaveBeenCalled()
    expect(mockError).not.toHaveBeenCalledWith(
      'Client tool provenance could not be restored',
      expect.anything()
    )
  })

  it('never falls back to an unsealed durable result when sealing fails', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    encryptSecret.mockRejectedValueOnce(new Error('encryption unavailable'))

    await forceFailHungToolCall(toolCall.id, context, execContext)

    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
    expect(toolCall.status).toBe('error')
    expect(toolCall.error).toContain('outcome is unknown')
    expect(registry.isComplete()).toBe(true)
  })

  it('retains structural failure compatibility when no provenance registry exists', async () => {
    const { toolCall, context } = createHungClient()

    await forceFailHungToolCall(toolCall.id, context, { userId: 'user-1' })

    expect(toolCall.status).toBe('error')
    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { error: expect.any(String), outcomeUnknown: true, doNotRetry: true },
      })
    )
    expect(encryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    ['file output', maybeWriteOutputToFile],
    ['table output', maybeWriteOutputToTable],
    ['CSV output', maybeWriteReadCsvToTable],
  ] as const)(
    'ignores a late %s completion after watchdog settlement',
    async (_name, postprocess) => {
      const toolCall = buildPendingToolCall()
      const context = buildStreamingContext(toolCall)
      const execContext: ExecutionContext = {
        userId: 'user-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      }
      const result = { success: true, output: 'late output' }
      executeTool.mockResolvedValueOnce(result)
      let finishPostprocessing: (value: typeof result) => void = () => {}
      let startedPostprocessing: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        startedPostprocessing = resolve
      })
      vi.mocked(postprocess).mockImplementationOnce(async () => {
        startedPostprocessing()
        return await new Promise<typeof result>((resolve) => {
          finishPostprocessing = resolve
        })
      })
      const execution = executeToolAndReport(toolCall.id, context, execContext)
      await started
      await forceFailHungToolCall(toolCall.id, context, execContext)
      finishPostprocessing(result)
      const completion = await execution

      expect(completion.status).toBe('error')
      expect(completion.message).toContain('hung')
      expect(toolCall.status).toBe('error')
      expect(completeAsyncToolCall).toHaveBeenCalledTimes(1)
      expect(publishToolConfirmation).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(completion)).not.toContain('late output')
    }
  )

  it.each([false, true])(
    'does not publish a stale completion when the watchdog wins during persistence (aborted: %s)',
    async (aborted) => {
      const toolCall = buildPendingToolCall()
      const context = buildStreamingContext(toolCall)
      const execContext: ExecutionContext = {
        userId: 'user-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      }
      const result = { success: true, output: 'late output' }
      executeTool.mockResolvedValueOnce(result)
      let finishPostprocessing: (value: typeof result) => void = () => {}
      let startedPostprocessing: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        startedPostprocessing = resolve
      })
      vi.mocked(maybeWriteOutputToFile).mockImplementationOnce(async () => {
        startedPostprocessing()
        return await new Promise<typeof result>((resolve) => {
          finishPostprocessing = resolve
        })
      })
      let finishWatchdogPersistence: (value: object) => void = () => {}
      let startedWatchdogPersistence: () => void = () => {}
      const watchdogWriting = new Promise<void>((resolve) => {
        startedWatchdogPersistence = resolve
      })
      completeAsyncToolCall.mockImplementationOnce(async () => {
        startedWatchdogPersistence()
        return await new Promise<object>((resolve) => {
          finishWatchdogPersistence = resolve
        })
      })
      let finishToolPersistence: (value: null) => void = () => {}
      let startedToolPersistence: () => void = () => {}
      const toolWriting = new Promise<void>((resolve) => {
        startedToolPersistence = resolve
      })
      completeAsyncToolCall.mockImplementationOnce(async () => {
        startedToolPersistence()
        return await new Promise<null>((resolve) => {
          finishToolPersistence = resolve
        })
      })

      const controller = new AbortController()
      const execution = executeToolAndReport(toolCall.id, context, execContext, {
        onEvent,
        abortSignal: controller.signal,
      })
      await started
      const watchdog = forceFailHungToolCall(toolCall.id, context, execContext)
      await watchdogWriting
      if (aborted) controller.abort()
      finishPostprocessing(result)
      await toolWriting
      finishWatchdogPersistence({ status: 'failed' })
      await watchdog
      finishToolPersistence(null)
      const completion = await execution

      expect(completion.status).toBe('error')
      expect(completion.message).toContain('hung')
      expect(toolCall.status).toBe('error')
      expect(publishToolConfirmation).toHaveBeenCalledTimes(1)
      expect(onEvent).not.toHaveBeenCalled()
      expect(JSON.stringify(completion)).not.toContain('late output')
    }
  )

  it('ignores a late postprocessing rejection after watchdog settlement', async () => {
    const toolCall = buildPendingToolCall()
    const context = buildStreamingContext(toolCall)
    const execContext: ExecutionContext = {
      userId: 'user-1',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    }
    executeTool.mockResolvedValueOnce({ success: true, output: 'late output' })
    let rejectPostprocessing: (error: Error) => void = () => {}
    let startedPostprocessing: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      startedPostprocessing = resolve
    })
    vi.mocked(maybeWriteOutputToFile).mockImplementationOnce(async () => {
      startedPostprocessing()
      return await new Promise<never>((_resolve, reject) => {
        rejectPostprocessing = reject
      })
    })
    const execution = executeToolAndReport(toolCall.id, context, execContext)
    await started
    await forceFailHungToolCall(toolCall.id, context, execContext)
    rejectPostprocessing(new Error('late rejected secret output'))
    const completion = await execution

    expect(completion.status).toBe('error')
    expect(completion.message).toContain('hung')
    expect(completeAsyncToolCall).toHaveBeenCalledTimes(1)
    expect(publishToolConfirmation).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(completion)).not.toContain('late rejected secret output')
  })
})
