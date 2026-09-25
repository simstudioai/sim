import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  encryptSecret,
  decryptSecret,
  waitForToolConfirmation,
  getToolConfirmation,
  replaceTerminalAsyncToolCallResult,
  getTrustedWorkflowToolExecution,
  mockError,
} = vi.hoisted(() => ({
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  waitForToolConfirmation: vi.fn(),
  getToolConfirmation: vi.fn(),
  replaceTerminalAsyncToolCallResult: vi.fn(),
  getTrustedWorkflowToolExecution: vi.fn(),
  mockError: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mockError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret,
  decryptSecret,
}))

vi.mock('@/lib/mothership/persistence/tool-confirm', () => ({
  waitForToolConfirmation,
  getToolConfirmation,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  replaceTerminalAsyncToolCallResult,
}))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getTrustedWorkflowToolExecution,
}))

import { emitSyntheticToolResult } from '@/lib/mothership/request/handlers/types'
import {
  waitForClientToolCompletion,
  waitForWorkflowToolCompletion,
} from '@/lib/mothership/request/tools/client'
import {
  SEALED_CLIENT_TOOL_PROJECTION_FIELD,
  sealClientToolContext,
  sealProjectedClientToolCompletion,
} from '@/lib/mothership/request/tools/client-completion-seal.server'
import { TOOL_RESULT_UNAVAILABLE_ERROR } from '@/lib/mothership/request/tools/resolved-secret-result'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const TRACE_SCOPE = { userId: 'user-1', workspaceId: 'workspace-1' }

function createParentRegistry(): ResolvedSecretTraceRegistry {
  const registry = new ResolvedSecretTraceRegistry(
    [
      {
        name: 'PARENT_SECRET',
        plaintext: 'parent-secret-value',
        encryptedValue: 'encrypted-parent-secret',
      },
    ],
    TRACE_SCOPE
  )
  registry.recordResolved('PARENT_SECRET', 'parent-secret-value')
  return registry
}

function createClientRegistry(): ResolvedSecretTraceRegistry {
  const registry = new ResolvedSecretTraceRegistry(
    [
      {
        name: 'SECRET',
        plaintext: 'resolved-secret',
        encryptedValue: 'encrypted-secret',
      },
    ],
    TRACE_SCOPE
  )
  registry.recordResolved('SECRET', 'resolved-secret')
  return registry
}

function trustedExecution(executionId: string) {
  return {
    executionId,
    workflowId: 'workflow-1',
    status: 'completed' as const,
    contentAvailable: true as const,
    finalOutput: { value: `child read parent-secret-value from ${executionId}` },
    blockLogs: [],
    provenance: {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'PARENT_SECRET', encryptedValue: 'encrypted-parent-secret' }],
      scope: TRACE_SCOPE,
    },
  }
}

describe('workflow client tool completion', () => {
  beforeEach(() => {
    decryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted:
        encrypted === 'encrypted-parent-secret'
          ? 'parent-secret-value'
          : encrypted === 'encrypted-child-secret'
            ? 'child-secret-value'
            : encrypted,
    }))
    replaceTerminalAsyncToolCallResult.mockResolvedValue({ status: 'completed' })
  })

  it('keeps a safe busy reason when no execution was launched', async () => {
    waitForToolConfirmation.mockResolvedValue({
      status: 'error',
      data: { code: 'WORKFLOW_EXECUTION_BUSY', error: 'untrusted text' },
    })
    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
    })
    expect(completion?.data).toEqual({
      success: false,
      workflowId: 'workflow-1',
      code: 'WORKFLOW_EXECUTION_BUSY',
      error:
        'Workflow is already executing. Wait for the current execution to finish before running it again.',
    })
    expect(completion?.message).toBe(
      'Workflow is already executing. Wait for the current execution to finish before running it again.'
    )
    expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
  })

  it('selects requested trusted outputs after redaction and omits full client logs', async () => {
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue({
      ...trustedExecution('execution-1'),
      blockLogs: [
        { blockId: 'b1', blockName: 'Read Value', output: { result: 'earlier' } },
        {
          blockId: 'b1',
          blockName: 'Read Value',
          output: { result: 'parent-secret-value', count: 3 },
        },
      ],
    })
    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry: createParentRegistry(),
      select: ['readvalue.result', 'b1.count', 'Missing.result'],
    })
    expect(completion?.data).toMatchObject({
      selected: {
        'readvalue.result': '{{PARENT_SECRET}}',
        'b1.count': 3,
        'Missing.result': { unresolved: 'no executed block named "Missing"' },
      },
      logsOmitted: true,
    })
    expect(completion?.data).not.toHaveProperty('logs')
    expect(JSON.stringify(completion)).not.toContain('parent-secret-value')
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith(
      expect.objectContaining({ result: completion?.data })
    )
  })

  it('projects a parent secret laundered through a child workflow before every live sink', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue(trustedExecution('execution-1'))

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(getTrustedWorkflowToolExecution).toHaveBeenCalledWith(
      'execution-1',
      'workflow-1',
      'tool-1'
    )
    expect(completion).toEqual({
      status: 'success',
      message: 'Workflow execution completed.',
      data: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        output: { value: 'child read {{PARENT_SECRET}} from execution-1' },
        logs: [],
      },
    })
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'completed',
      result: completion?.data,
      error: null,
    })
    expect(JSON.stringify(completion)).not.toContain('parent-secret-value')
    expect(JSON.stringify(replaceTerminalAsyncToolCallResult.mock.calls)).not.toContain(
      'parent-secret-value'
    )
  })

  it('preserves the server-confirmed status while omitting unavailable execution content', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1', output: 'untrusted' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue(null)

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'success',
      message: 'Workflow execution completed.',
      data: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
    expect(JSON.stringify(completion)).not.toContain('untrusted')
  })

  it('uses compacted terminal status without exposing unavailable execution content', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'failed',
      contentAvailable: false,
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'error',
      message: 'Workflow execution failed.',
      data: {
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
  })

  it('preserves cancellation when the bound terminal execution is not yet readable', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'cancelled',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue(null)

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'cancelled',
      message: 'Workflow execution was cancelled.',
      data: {
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        reason: 'user_cancelled',
        cancelledByUser: true,
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
  })

  it('rejects a legacy success without a trusted execution identity', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', output: 'untrusted' },
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'error',
      message: 'Workflow execution failed.',
      data: { success: false, workflowId: 'workflow-1' },
    })
    expect(registry.isComplete()).toBe(true)
    expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
    expect(JSON.stringify(completion)).not.toContain('untrusted')
  })

  it('preserves an allowlisted async deployment failure without an execution identity', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'error',
      message: 'Workflow execution failed.',
      data: {
        success: false,
        workflowId: 'workflow-1',
        code: 'ASYNC_WORKFLOW_DEPLOYMENT_STALE',
        error: 'untrusted client detail',
      },
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'error',
      message: 'Async execution requires the current workflow to match its deployed version',
      data: {
        success: false,
        workflowId: 'workflow-1',
        code: 'ASYNC_WORKFLOW_DEPLOYMENT_STALE',
        error: 'Async execution requires the current workflow to match its deployed version',
      },
    })
    expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
    expect(JSON.stringify(completion)).not.toContain('untrusted client detail')
  })

  it('uses the bound execution status when provenance is incomplete', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue({
      ...trustedExecution('execution-1'),
      status: 'failed',
      error: 'trusted failure',
      provenance: {
        version: 1,
        complete: false,
        entries: [],
        scope: TRACE_SCOPE,
      },
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'error',
      message: 'Workflow execution failed.',
      data: {
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
  })

  it('imports and projects a secret activated only inside the child workflow', async () => {
    const registry = new ResolvedSecretTraceRegistry([], TRACE_SCOPE)
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'completed',
      contentAvailable: true,
      finalOutput: { value: 'child-secret-value' },
      blockLogs: [],
      provenance: {
        version: 1,
        complete: true,
        entries: [{ name: 'CHILD_SECRET', encryptedValue: 'encrypted-child-secret' }],
        scope: TRACE_SCOPE,
      },
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(decryptSecret).toHaveBeenCalledWith('encrypted-child-secret')
    expect(completion?.data).toEqual({
      success: true,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      output: { value: '{{CHILD_SECRET}}' },
      logs: [],
    })
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'child-secret-value', replacement: '{{CHILD_SECRET}}' },
    ])
    expect(JSON.stringify(completion)).not.toContain('child-secret-value')
  })

  it('discards imported child provenance when workflow-result projection fails', async () => {
    const registry = new ResolvedSecretTraceRegistry([], TRACE_SCOPE)
    const cyclicOutput: Record<string, unknown> = { value: 'child-secret-value' }
    cyclicOutput.self = cyclicOutput
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'completed',
      contentAvailable: true,
      finalOutput: cyclicOutput,
      blockLogs: [],
      provenance: {
        version: 1,
        complete: true,
        entries: [{ name: 'CHILD_SECRET', encryptedValue: 'encrypted-child-secret' }],
        scope: TRACE_SCOPE,
      },
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'success',
      message: 'Workflow execution completed.',
      data: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify(completion)).not.toContain('child-secret-value')
  })

  it('corrects the client terminal status from the bound execution log', async () => {
    const registry = new ResolvedSecretTraceRegistry([], TRACE_SCOPE)
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'failed',
      contentAvailable: true,
      error: 'trusted failure',
      blockLogs: [],
      provenance: { version: 1, complete: true, entries: [], scope: TRACE_SCOPE },
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toMatchObject({
      status: 'error',
      message: 'trusted failure',
      data: {
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        error: 'trusted failure',
      },
    })
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'failed',
      result: completion?.data,
      error: 'trusted failure',
    })
  })

  it('treats background completion as structural and incomplete', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockResolvedValue({
      status: 'background',
      data: {
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        output: 'untrusted-background-output',
      },
    })

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'background',
      message: 'Workflow execution is continuing in the background.',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    expect(registry.isComplete()).toBe(true)
    expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
  })

  it('fails structurally when trusted child provenance cannot be imported', async () => {
    const registry = createParentRegistry()
    const importSpy = vi
      .spyOn(ResolvedSecretTraceRegistry.prototype, 'importCrossingProvenance')
      .mockRejectedValueOnce(new Error('decryption unavailable'))
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValue(trustedExecution('execution-1'))

    const completion = await waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })
    importSpy.mockRestore()

    expect(completion).toEqual({
      status: 'success',
      message: 'Workflow execution completed.',
      data: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(JSON.stringify(completion)).not.toContain('parent-secret-value')
  })

  it('keeps parallel workflow results safe while sibling provenance is unresolved', async () => {
    const registry = createParentRegistry()
    waitForToolConfirmation.mockImplementation((toolCallId: string) =>
      Promise.resolve({
        status: 'success',
        data: {
          workflowId: 'workflow-1',
          executionId: toolCallId === 'tool-1' ? 'execution-1' : 'execution-2',
        },
      })
    )

    const resolvers = new Map<string, (value: ReturnType<typeof trustedExecution>) => void>()
    getTrustedWorkflowToolExecution.mockImplementation(
      (executionId: string) =>
        new Promise((resolve) => {
          resolvers.set(executionId, resolve)
        })
    )

    const firstPromise = waitForWorkflowToolCompletion({
      toolCallId: 'tool-1',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })
    const secondPromise = waitForWorkflowToolCompletion({
      toolCallId: 'tool-2',
      workflowId: 'workflow-1',
      timeoutMs: 1_000,
      registry,
    })

    await vi.waitFor(() => expect(resolvers.size).toBe(2))
    resolvers.get('execution-1')?.(trustedExecution('execution-1'))
    const first = await firstPromise

    expect(first).toEqual({
      status: 'success',
      message: 'Workflow execution completed.',
      data: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        output: { value: 'child read {{PARENT_SECRET}} from execution-1' },
        logs: [],
      },
    })

    resolvers.get('execution-2')?.(trustedExecution('execution-2'))
    const second = await secondPromise

    expect(second).toEqual({
      status: 'success',
      message: 'Workflow execution completed.',
      data: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-2',
        output: { value: 'child read {{PARENT_SECRET}} from execution-2' },
        logs: [],
      },
    })
    expect(JSON.stringify([first, second])).not.toContain('parent-secret-value')
    expect(JSON.stringify(replaceTerminalAsyncToolCallResult.mock.calls)).not.toContain(
      'parent-secret-value'
    )
  })
})

describe('generic client tool completion', () => {
  beforeEach(() => {
    encryptSecret.mockImplementation(async (plaintext: string) => ({
      encrypted: plaintext,
      iv: 'iv',
    }))
    decryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted === 'encrypted-secret' ? 'resolved-secret' : encrypted,
    }))
    replaceTerminalAsyncToolCallResult.mockResolvedValue({ status: 'completed' })
  })

  it('unseals exact-bound content and provenance, then persists only the projected result', async () => {
    const registry = createClientRegistry()
    const sealedContext = await sealClientToolContext({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      registry,
      toolInput: { query: 'resolved-secret' },
    })
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: {
        __sealedClientToolCompletionV1: JSON.stringify({
          toolCallId: 'tool-1',
          runId: 'run-1',
          userId: 'user-1',
          message: 'Read resolved-secret',
          data: { content: 'prefix-resolved-secret-suffix' },
        }),
        ...sealedContext,
      },
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'success',
      message: 'Read {{SECRET}}',
      data: { content: 'prefix-{{SECRET}}-suffix' },
    })
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { [SEALED_CLIENT_TOOL_PROJECTION_FIELD]: expect.any(String) },
      expectedResult: expect.any(Object),
      error: null,
    })
    expect(
      JSON.parse(
        replaceTerminalAsyncToolCallResult.mock.calls[0][0].result[
          SEALED_CLIENT_TOOL_PROJECTION_FIELD
        ]
      ).data
    ).toEqual({ content: 'prefix-{{SECRET}}-suffix' })
    expect(JSON.stringify(completion)).not.toContain('resolved-secret')
    expect(
      JSON.stringify(replaceTerminalAsyncToolCallResult.mock.calls.map(([input]) => input.result))
    ).not.toContain('resolved-secret')
  })

  it.each(['state', 'action'] as const)(
    'keeps a large %s screenshot out of synthetic replay without losing sealed state or model image bytes',
    async (kind) => {
      const registry = createClientRegistry()
      const image = Buffer.alloc(2_100_000, 1).toString('base64')
      const state = {
        kind: 'state',
        bundleId: 'com.example.Fixture',
        snapshotId: 'snapshot',
        windowId: '1',
        accessibilityTree: 'editor AXTextArea editable value="resolved-secret"',
        screenshotSize: { width: 1600, height: 1169 },
      }
      const metadata = { name: 'Computer screenshot', mediaType: 'image/png' }
      const output = {
        ...(kind === 'state'
          ? state
          : {
              kind: 'action',
              action: 'activate_app',
              bundleId: state.bundleId,
              dispatched: true,
              verified: false,
              observation: state,
            }),
        observations: [{ ...metadata, data: image }],
      }
      const safeState = {
        ...state,
        accessibilityTree: 'editor AXTextArea editable value="{{SECRET}}"',
      }
      const safeOutput = {
        ...output,
        ...(kind === 'state' ? safeState : { observation: safeState }),
      }
      const sealedContext = await sealClientToolContext({
        toolCallId: 'tool-image',
        runId: 'run-1',
        userId: 'user-1',
        registry,
        toolInput: {
          action: kind === 'state' ? 'get_app_state' : 'activate_app',
          bundleId: state.bundleId,
          query: 'resolved-secret',
        },
      })
      waitForToolConfirmation.mockResolvedValue({
        status: 'success',
        data: {
          ...sealedContext,
          __sealedClientToolCompletionV1: JSON.stringify({
            toolCallId: 'tool-image',
            runId: 'run-1',
            userId: 'user-1',
            data: output,
          }),
        },
      })
      const completion = await waitForClientToolCompletion({
        toolCallId: 'tool-image',
        runId: 'run-1',
        userId: 'user-1',
        timeoutMs: 1000,
        registry,
      })
      expect(completion?.data).toEqual(safeOutput)
      expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
        toolCallId: 'tool-image',
        status: 'completed',
        result: { [SEALED_CLIENT_TOOL_PROJECTION_FIELD]: expect.any(String) },
        expectedResult: expect.any(Object),
        error: null,
      })
      const onEvent = vi.fn()
      await emitSyntheticToolResult('tool-image', 'computer', completion, { onEvent })
      expect(Buffer.byteLength(JSON.stringify(onEvent.mock.calls))).toBeLessThan(1_048_576)
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ output: { ...safeOutput, observations: [metadata] } }),
        })
      )
      expect(completion?.data).toEqual(safeOutput)
      const receipt = structuredClone(replaceTerminalAsyncToolCallResult.mock.calls[0][0].result)
      waitForToolConfirmation.mockResolvedValue({ status: 'success', data: receipt })
      const recovered = await waitForClientToolCompletion({
        toolCallId: 'tool-image',
        runId: 'run-1',
        userId: 'user-1',
        timeoutMs: 1000,
        registry: new ResolvedSecretTraceRegistry([], TRACE_SCOPE),
      })
      expect(recovered).toEqual(completion)
      expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledOnce()
    }
  )

  it.each(['success', 'error', 'cancelled'] as const)(
    'recovers an authenticated %s result under a new registry without rewriting its receipt',
    async (status) => {
      for (const data of [null, false, 42, ['result'], { content: '{{SECRET}}' }]) {
        const receipt = await sealProjectedClientToolCompletion({
          toolCallId: 'receipt-tool',
          runId: 'run-1',
          userId: 'user-1',
          status,
          message: 'Projected completion',
          data,
        })
        waitForToolConfirmation.mockResolvedValue({ status, data: receipt })
        expect(
          await waitForClientToolCompletion({
            toolCallId: 'receipt-tool',
            runId: 'run-1',
            userId: 'user-1',
            registry: new ResolvedSecretTraceRegistry([], TRACE_SCOPE),
            timeoutMs: 1000,
          })
        ).toEqual({ status, message: 'Projected completion', data })
      }
      expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
    }
  )

  it.each(['tool', 'run', 'user', 'status', 'purpose', 'ciphertext'])(
    'refuses a projection receipt with an invalid %s without rewriting the durable source',
    async (mismatch) => {
      const content = {
        toolCallId: mismatch === 'tool' ? 'other-tool' : 'receipt-tool',
        runId: mismatch === 'run' ? 'other-run' : 'run-1',
        userId: mismatch === 'user' ? 'other-user' : 'user-1',
        status: mismatch === 'status' ? ('cancelled' as const) : ('success' as const),
        message: 'Untrusted result',
        data: { value: 'must not escape' },
      }
      const receipt = await sealProjectedClientToolCompletion(content)
      if (mismatch === 'purpose')
        receipt[SEALED_CLIENT_TOOL_PROJECTION_FIELD] = JSON.stringify({
          ...content,
          purpose: 'raw-client-completion',
        })
      if (mismatch === 'ciphertext')
        decryptSecret.mockRejectedValueOnce(new Error('Authentication failed'))
      waitForToolConfirmation.mockResolvedValue({ status: 'success', data: receipt })
      const result = await waitForClientToolCompletion({
        toolCallId: 'receipt-tool',
        runId: 'run-1',
        userId: 'user-1',
        timeoutMs: 1000,
        registry: createClientRegistry(),
      })
      expect(result).toMatchObject({
        status: 'error',
        data: { resultWithheld: true, doNotRetry: true },
      })
      expect(JSON.stringify(result)).not.toContain('must not escape')
      expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
    }
  )

  it.each(['seal-fails', 'winner', 'invalid-winner'])(
    'preserves the durable source when receipt persistence %s',
    async (scenario) => {
      const registry = createClientRegistry()
      const binding = { toolCallId: 'race-tool', runId: 'run-1', userId: 'user-1' }
      const context = await sealClientToolContext({ ...binding, registry, toolInput: {} })
      const source = {
        ...context,
        __sealedClientToolCompletionV1: JSON.stringify({
          ...binding,
          data: { value: 'candidate' },
        }),
      }
      waitForToolConfirmation.mockResolvedValue({ status: 'success', data: source })
      if (scenario === 'seal-fails')
        encryptSecret.mockRejectedValueOnce(new Error('Encryption unavailable'))
      else {
        replaceTerminalAsyncToolCallResult.mockResolvedValueOnce(null)
        const winner = await sealProjectedClientToolCompletion({
          ...binding,
          status: 'success',
          message: 'Canonical winner',
          data: { value: 'winner' },
        })
        getToolConfirmation.mockResolvedValueOnce({
          status: 'success',
          data: scenario === 'winner' ? winner : { value: 'untrusted winner' },
        })
      }
      const result = await waitForClientToolCompletion({ ...binding, registry, timeoutMs: 1000 })
      if (scenario === 'winner')
        expect(result).toEqual({
          status: 'success',
          message: 'Canonical winner',
          data: { value: 'winner' },
        })
      else
        expect(result).toMatchObject({
          status: 'error',
          data: { resultWithheld: true, doNotRetry: true },
        })
      if (scenario === 'seal-fails')
        expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
      else {
        expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledOnce()
        expect(replaceTerminalAsyncToolCallResult.mock.calls[0][0].expectedResult).toEqual(source)
      }
    }
  )

  it('preserves trusted public output equal to an unrelated active low-entropy secret', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'LOW_ENTROPY_SECRET',
          plaintext: 'true',
          encryptedValue: 'encrypted-low-entropy-secret',
        },
      ],
      TRACE_SCOPE
    )
    registry.recordResolved('LOW_ENTROPY_SECRET', 'true')
    const sealedContext = await sealClientToolContext({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      registry,
      toolInput: { query: 'public status' },
    })
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: {
        __sealedClientToolCompletionV1: JSON.stringify({
          toolCallId: 'tool-1',
          runId: 'run-1',
          userId: 'user-1',
          data: { enabled: true, label: 'true' },
        }),
        ...sealedContext,
      },
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'success',
      message: 'Tool completed',
      data: { enabled: true, label: 'true' },
    })
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { [SEALED_CLIENT_TOOL_PROJECTION_FIELD]: expect.any(String) },
      expectedResult: expect.any(Object),
      error: null,
    })
  })

  it('does not invalidate later tool results while a sibling activation is pending', async () => {
    const registry = createClientRegistry()
    const firstContext = await sealClientToolContext({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      registry,
      toolInput: { query: 'resolved-secret' },
    })
    waitForToolConfirmation.mockResolvedValueOnce({
      status: 'success',
      data: {
        __sealedClientToolCompletionV1: JSON.stringify({
          toolCallId: 'tool-1',
          runId: 'run-1',
          userId: 'user-1',
          data: { content: 'resolved-secret' },
        }),
        ...firstContext,
      },
    })

    const finishSiblingActivation = registry.beginPendingActivation()
    const first = await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(first).toEqual({
      status: 'success',
      message: 'Tool completed',
      data: { content: '{{SECRET}}' },
    })
    expect(registry.isPermanentlyIncomplete()).toBe(false)
    finishSiblingActivation()
    expect(registry.isComplete()).toBe(true)

    const secondContext = await sealClientToolContext({
      toolCallId: 'tool-2',
      runId: 'run-1',
      userId: 'user-1',
      registry,
      toolInput: { query: 'resolved-secret' },
    })
    waitForToolConfirmation.mockResolvedValueOnce({
      status: 'success',
      data: {
        __sealedClientToolCompletionV1: JSON.stringify({
          toolCallId: 'tool-2',
          runId: 'run-1',
          userId: 'user-1',
          data: { content: 'resolved-secret' },
        }),
        ...secondContext,
      },
    })

    const second = await waitForClientToolCompletion({
      toolCallId: 'tool-2',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(second).toEqual({
      status: 'success',
      message: 'Tool completed',
      data: { content: '{{SECRET}}' },
    })
  })

  it('fails structurally without an execution registry', async () => {
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: {
        __sealedClientToolCompletionV1: 'sealed-completion',
        __sealedClientToolContextV1: 'sealed-context',
      },
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
    })

    expect(completion).toMatchObject({
      status: 'error',
      message: TOOL_RESULT_UNAVAILABLE_ERROR,
      data: { resultWithheld: true, outcomeUnknown: true, doNotRetry: true },
    })
    expect(decryptSecret).not.toHaveBeenCalled()
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong tool', { toolCallId: 'other-tool', runId: 'run-1', userId: 'user-1' }],
    ['wrong run', { toolCallId: 'tool-1', runId: 'other-run', userId: 'user-1' }],
    ['wrong user', { toolCallId: 'tool-1', runId: 'run-1', userId: 'other-user' }],
  ])('fails structurally for a completion bound to the %s', async (_label, sealedBinding) => {
    const registry = createClientRegistry()
    const sealedContext = await sealClientToolContext({
      ...sealedBinding,
      registry,
      toolInput: { query: 'resolved-secret' },
    })
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: {
        __sealedClientToolCompletionV1: JSON.stringify({
          ...sealedBinding,
          data: { content: 'untrusted-secret' },
        }),
        ...sealedContext,
      },
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toMatchObject({
      status: 'error',
      message: TOOL_RESULT_UNAVAILABLE_ERROR,
      data: { resultWithheld: true, outcomeUnknown: true, doNotRetry: true },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
    expect(JSON.stringify(completion)).not.toContain('untrusted-secret')
  })

  it('fails structurally when a restarted execution uses a new registry instance', async () => {
    const sourceRegistry = createClientRegistry()
    const resumedRegistry = new ResolvedSecretTraceRegistry([], TRACE_SCOPE)
    const sealedContext = await sealClientToolContext({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      registry: sourceRegistry,
      toolInput: { query: 'resolved-secret' },
    })
    waitForToolConfirmation.mockResolvedValue({
      status: 'success',
      data: {
        __sealedClientToolCompletionV1: JSON.stringify({
          toolCallId: 'tool-1',
          runId: 'run-1',
          userId: 'user-1',
          data: { content: 'resolved-secret' },
        }),
        ...sealedContext,
      },
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
      registry: resumedRegistry,
    })

    expect(completion).toMatchObject({
      status: 'error',
      message: TOOL_RESULT_UNAVAILABLE_ERROR,
      data: { resultWithheld: true, outcomeUnknown: true, doNotRetry: true },
    })
    expect(resumedRegistry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
    expect(JSON.stringify(completion)).not.toContain('resolved-secret')
  })

  it('fails structurally for a legacy raw confirmation without sealed provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry([], TRACE_SCOPE)
    waitForToolConfirmation.mockResolvedValue({
      status: 'error',
      message: 'raw error secret',
      data: { content: 'raw result secret' },
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      timeoutMs: 1_000,
      registry,
    })

    expect(completion).toEqual({
      status: 'error',
      message: TOOL_RESULT_UNAVAILABLE_ERROR,
      data: {
        error: TOOL_RESULT_UNAVAILABLE_ERROR,
        resultWithheld: true,
        outcomeUnknown: true,
        doNotRetry: true,
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
    expect(JSON.stringify(completion)).not.toContain('raw')
  })

  it.each([
    { kind: 'missing-completion', completionFailure: 'missing-envelope' },
    { kind: 'missing-context', contextFailure: 'missing-envelope' },
    { kind: 'malformed-completion', completionFailure: 'malformed-envelope' },
    { kind: 'decrypt-failure', completionFailure: 'decrypt-failed' },
    { kind: 'invalid-json', completionFailure: 'invalid-json' },
    { kind: 'invalid-content', completionFailure: 'invalid-content' },
    { kind: 'wrong-binding', completionFailure: 'binding-mismatch' },
    { kind: 'wrong-registry', contextFailure: 'registry-mismatch' },
    { kind: 'invalid-provenance', contextFailure: 'invalid-provenance' },
  ])(
    'attributes $kind without replacing the source or logging sealed content',
    async ({ kind, ...failures }) => {
      const registry = createClientRegistry()
      const binding = { toolCallId: 'tool-1', runId: 'run-1', userId: 'user-1' }
      const sealedContext = await sealClientToolContext({
        ...binding,
        registry,
        toolInput: { query: 'resolved-secret' },
      })
      const data: Record<string, unknown> = {
        ...sealedContext,
        __sealedClientToolCompletionV1: JSON.stringify({
          ...binding,
          data: { content: 'resolved-secret' },
        }),
      }
      switch (kind) {
        case 'missing-completion':
          data.__sealedClientToolCompletionV1 = undefined
          break
        case 'missing-context':
          data.__sealedClientToolContextV1 = undefined
          break
        case 'malformed-completion':
          data.__sealedClientToolCompletionV1 = 1
          break
        case 'decrypt-failure':
          data.__sealedClientToolCompletionV1 = 'sensitive-ciphertext'
          decryptSecret.mockImplementation(async (encrypted: string) => {
            if (encrypted === 'sensitive-ciphertext') throw new Error('sensitive-decrypt-error')
            return { decrypted: encrypted }
          })
          break
        case 'invalid-json':
          data.__sealedClientToolCompletionV1 = 'sensitive-invalid-json'
          break
        case 'invalid-content':
          data.__sealedClientToolCompletionV1 = JSON.stringify({ ...binding, message: 1 })
          break
        case 'wrong-binding':
          data.__sealedClientToolCompletionV1 = JSON.stringify({
            ...binding,
            toolCallId: 'different-tool',
          })
          break
        case 'wrong-registry':
          Object.assign(
            data,
            await sealClientToolContext({
              ...binding,
              registry: createClientRegistry(),
              toolInput: {},
            })
          )
          break
        case 'invalid-provenance': {
          const context = JSON.parse(sealedContext.__sealedClientToolContextV1)
          data.__sealedClientToolContextV1 = JSON.stringify({
            ...context,
            provenance: { version: 999 },
          })
          break
        }
      }
      waitForToolConfirmation.mockResolvedValue({ status: 'success', data })

      await waitForClientToolCompletion({ ...binding, registry, timeoutMs: 1_000 })

      const diagnostics = mockError.mock.calls.filter(
        ([message]) => message === 'Client tool provenance could not be restored'
      )
      expect(diagnostics).toEqual([
        [
          'Client tool provenance could not be restored',
          {
            toolCallId: binding.toolCallId,
            runId: binding.runId,
            ...failures,
          },
        ],
      ])
      expect(replaceTerminalAsyncToolCallResult).not.toHaveBeenCalled()
      expect(JSON.stringify(diagnostics)).not.toMatch(/sensitive-|resolved-secret|SECRET|__sealed/)
      expect(registry.isPermanentlyIncomplete()).toBe(false)
    }
  )

  it('does not report an unseal fault when no run binding was supplied', async () => {
    waitForToolConfirmation.mockResolvedValue({ status: 'error', data: {} })
    await waitForClientToolCompletion({
      toolCallId: 'tool-1',
      userId: 'user-1',
      registry: createClientRegistry(),
      timeoutMs: 1_000,
    })
    expect(
      mockError.mock.calls.filter(
        ([message]) => message === 'Client tool provenance could not be restored'
      )
    ).toEqual([])
    expect(decryptSecret).not.toHaveBeenCalled()
  })
})
