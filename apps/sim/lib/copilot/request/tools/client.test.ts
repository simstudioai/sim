/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  encryptSecret,
  decryptSecret,
  waitForToolConfirmation,
  replaceTerminalAsyncToolCallResult,
  getTrustedWorkflowToolExecution,
  mockError,
} = vi.hoisted(() => ({
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  waitForToolConfirmation: vi.fn(),
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

vi.mock('@/lib/copilot/persistence/tool-confirm', () => ({
  waitForToolConfirmation,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  replaceTerminalAsyncToolCallResult,
}))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getTrustedWorkflowToolExecution,
}))

import {
  waitForClientToolCompletion,
  waitForWorkflowToolCompletion,
} from '@/lib/copilot/request/tools/client'
import { sealClientToolContext } from '@/lib/copilot/request/tools/client-completion-seal.server'
import { TOOL_RESULT_UNAVAILABLE_ERROR } from '@/lib/copilot/request/tools/resolved-secret-result'
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
    vi.clearAllMocks()
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
    vi.clearAllMocks()
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
      result: { content: 'prefix-{{SECRET}}-suffix' },
      error: null,
    })
    expect(JSON.stringify(completion)).not.toContain('resolved-secret')
    expect(JSON.stringify(replaceTerminalAsyncToolCallResult.mock.calls)).not.toContain(
      'resolved-secret'
    )
  })

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
      result: { enabled: true, label: 'true' },
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

    expect(completion).toEqual({
      status: 'success',
      message: 'Tool completed',
      data: { success: true },
    })
    expect(decryptSecret).not.toHaveBeenCalled()
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { success: true },
      error: null,
    })
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

    expect(completion).toEqual({
      status: 'success',
      message: 'Tool completed',
      data: { success: true },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { success: true },
      error: null,
    })
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

    expect(completion).toEqual({
      status: 'success',
      message: 'Tool completed',
      data: { success: true },
    })
    expect(resumedRegistry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { success: true },
      error: null,
    })
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
      data: { error: TOOL_RESULT_UNAVAILABLE_ERROR },
    })
    expect(registry.isComplete()).toBe(true)
    expect(replaceTerminalAsyncToolCallResult).toHaveBeenCalledWith({
      toolCallId: 'tool-1',
      status: 'failed',
      result: { error: TOOL_RESULT_UNAVAILABLE_ERROR },
      error: TOOL_RESULT_UNAVAILABLE_ERROR,
    })
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
    'attributes $kind before replacing the result without logging sealed content',
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
      expect(mockError.mock.invocationCallOrder[0]).toBeLessThan(
        replaceTerminalAsyncToolCallResult.mock.invocationCallOrder[0]
      )
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
