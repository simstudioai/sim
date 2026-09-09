/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionCallbacks } from '@/executor/execution/types'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

const {
  captureServerEventMock,
  executeWorkflowCoreMock,
  handlePostExecutionPauseStateMock,
  loggingSessionConstructorMock,
  projectDiagnosticErrorMock,
  safeStartMock,
  waitForPostExecutionMock,
  setTrustedExecutionCorrelationMock,
} = vi.hoisted(() => ({
  captureServerEventMock: vi.fn(),
  executeWorkflowCoreMock: vi.fn(),
  handlePostExecutionPauseStateMock: vi.fn(),
  loggingSessionConstructorMock: vi.fn(),
  projectDiagnosticErrorMock: vi.fn(),
  safeStartMock: vi.fn(),
  waitForPostExecutionMock: vi.fn(),
  setTrustedExecutionCorrelationMock: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: () => 'execution-1',
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    projectDiagnosticError = projectDiagnosticErrorMock
    safeStart = safeStartMock
    waitForPostExecution = waitForPostExecutionMock
    setTrustedExecutionCorrelation = setTrustedExecutionCorrelationMock

    constructor(...args: unknown[]) {
      loggingSessionConstructorMock(...args)
    }
  },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: captureServerEventMock,
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: executeWorkflowCoreMock,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: handlePostExecutionPauseStateMock,
}))

vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async (value: string) => {
    if (value !== 'encrypted-secret') throw new Error('Invalid ciphertext')
    return { decrypted: 'secret-value' }
  }),
}))

import { createWorkflowCellProgressWriter } from '@/lib/table/cell-write'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { hasExecutionResult } from '@/executor/utils/errors'

const workflowExecutionLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'WorkflowExecution'
)
const workflowExecutionLogger =
  loggerMock.createLogger.mock.results[workflowExecutionLoggerCallIndex]?.value
if (!workflowExecutionLogger) throw new Error('WorkflowExecution logger mock was not initialized')

const billingAttribution: BillingAttributionSnapshot = {
  actorUserId: 'actor-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization', id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: {
    id: 'subscription-1',
    referenceId: 'org-1',
    plan: 'team',
    status: 'active',
    seats: 5,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  },
}

const workflow = {
  id: 'workflow-1',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  variables: {},
}

const principal = {
  kind: 'session',
  userId: 'actor-1',
  sessionId: 'session-1',
} as const

describe('executeWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    safeStartMock.mockResolvedValue(true)
    waitForPostExecutionMock.mockResolvedValue(undefined)
    projectDiagnosticErrorMock.mockImplementation(
      (error: unknown, details: Record<string, unknown> = {}) => ({
        ...details,
        errorType: error instanceof Error ? 'error' : typeof error,
        hasStack: error instanceof Error && typeof error.stack === 'string',
      })
    )
    handlePostExecutionPauseStateMock.mockResolvedValue(undefined)
    executeWorkflowCoreMock.mockImplementation(
      async (params: {
        snapshot: ExecutionSnapshot
        loggingSession: { safeStart: (startParams: unknown) => Promise<boolean> }
      }) => {
        await params.loggingSession.safeStart({
          userId: params.snapshot.metadata.userId,
          billingAttribution: params.snapshot.metadata.billingAttribution,
          workspaceId: params.snapshot.metadata.workspaceId,
        })
        return {
          success: true,
          output: { ok: true },
          logs: [],
          metadata: { duration: 10 },
          status: 'completed',
        }
      }
    )
  })

  it('rejects workspace execution without immutable billing attribution', async () => {
    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
      })
    ).rejects.toThrow('Billing attribution is required for workspace execution')

    expect(executeWorkflowCoreMock).not.toHaveBeenCalled()
    expect(safeStartMock).not.toHaveBeenCalled()
  })

  it('rejects workspace execution without a principal', async () => {
    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
        principal: undefined as never,
        billingAttribution,
      })
    ).rejects.toThrow('Workflow execution principal is required')

    expect(executeWorkflowCoreMock).not.toHaveBeenCalled()
  })

  it.each([
    ['actor', { ...billingAttribution, actorUserId: 'other-actor' }],
    ['workspace', { ...billingAttribution, workspaceId: 'other-workspace' }],
  ])('rejects a billing attribution %s mismatch', async (_scope, mismatchedAttribution) => {
    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
        principal,
        billingAttribution: mismatchedAttribution,
      })
    ).rejects.toThrow('Workflow billing attribution does not match its actor and workspace')

    expect(executeWorkflowCoreMock).not.toHaveBeenCalled()
    expect(safeStartMock).not.toHaveBeenCalled()
  })

  it('asserts the billing attribution snapshot before execution', async () => {
    const malformedAttribution = {
      ...billingAttribution,
      billingPeriod: undefined,
    } as unknown as BillingAttributionSnapshot

    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
        principal,
        billingAttribution: malformedAttribution,
      })
    ).rejects.toThrow('Billing attribution snapshot is missing its billing period')

    expect(executeWorkflowCoreMock).not.toHaveBeenCalled()
  })

  it('propagates validated attribution through execution metadata to logger startup', async () => {
    await executeWorkflow(workflow, 'request-1', { prompt: 'hello' }, 'actor-1', {
      enabled: true,
      principal,
      workflowTriggerType: 'copilot',
      billingAttribution,
    })

    const coreParams = executeWorkflowCoreMock.mock.calls[0]?.[0] as {
      snapshot: ExecutionSnapshot
    }
    expect(coreParams.snapshot.metadata.billingAttribution).toEqual(billingAttribution)
    expect(Object.isFrozen(coreParams.snapshot.metadata.billingAttribution)).toBe(true)
    expect(safeStartMock).toHaveBeenCalledWith({
      userId: 'actor-1',
      billingAttribution,
      workspaceId: 'workspace-1',
    })
    expect(loggingSessionConstructorMock).toHaveBeenCalledWith(
      'workflow-1',
      'execution-1',
      'copilot',
      'request-1'
    )
  })

  it('forwards trusted initial trace-secret provenance to the execution core', async () => {
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
      scope: { userId: 'actor-1', workspaceId: 'workspace-1' },
    }

    await executeWorkflow(workflow, 'request-1', { prompt: 'hello' }, 'actor-1', {
      enabled: true,
      principal,
      billingAttribution,
      trustedInitialResolvedSecretTraceProvenance: provenance,
    })

    expect(executeWorkflowCoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ trustedInitialResolvedSecretTraceProvenance: provenance })
    )
  })

  it.each([
    ['secret-bearing', { complete: true, entries: [{ encryptedValue: 'encrypted-secret' }] }, true],
    ['exact-empty', { complete: true, entries: [] }, true],
    ['incomplete', { complete: false, entries: [] }, false],
    ['undecryptable', { complete: true, entries: [{ encryptedValue: 'invalid' }] }, false],
    ['legacy', undefined, false],
  ] as const)(
    'preserves %s provenance through the executor callback into table cells',
    async (_kind, source, complete) => {
      const provenance: ResolvedSecretTraceProvenanceV1 | undefined = source && {
        version: 1,
        complete: source.complete,
        entries: [...source.entries],
        scope: { userId: 'actor-1', workspaceId: 'workspace-1' },
      }
      const writeProgress = vi.fn().mockResolvedValue('wrote')
      const writer = createWorkflowCellProgressWriter({
        group: {
          id: 'group-1',
          workflowId: workflow.id,
          outputs: [{ blockId: 'block-1', path: 'output.value', columnName: 'column-1' }],
        },
        writeProgress,
        onWriteError: (error) => {
          throw error
        },
      })
      executeWorkflowCoreMock.mockImplementationOnce(
        async ({ callbacks }: { callbacks: ExecutionCallbacks }) => {
          await callbacks.onBlockComplete?.('block-1', 'Block', 'function', {
            output: { output: { value: 'secret-value' } },
            resolvedSecretTraceProvenance: provenance,
            executionTime: 1,
            startedAt: '2026-01-01T00:00:00Z',
            endedAt: '2026-01-01T00:00:01Z',
            executionOrder: 0,
          })
          return {
            success: true,
            output: {},
            logs: [],
            status: 'completed',
            metadata: { duration: 1 },
          }
        }
      )

      await executeWorkflow(workflow, 'request-1', {}, 'actor-1', {
        enabled: true,
        principal,
        billingAttribution,
        onBlockComplete: writer.onBlockComplete,
      })
      await writer.finish()

      expect(writer.getEventOutputs()).toEqual({ 'column-1': 'secret-value' })
      expect(writer.getPendingDataPatch()).toEqual({})
      expect(writeProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          dataPatch: { 'column-1': 'secret-value' },
          secretProvenance: { complete, columns: complete ? { 'column-1': provenance } : {} },
        })
      )
    }
  )

  it('forwards a trusted immutable workflow state to the execution snapshot', async () => {
    const workflowStateOverride = {
      blocks: { 'block-1': { id: 'block-1', type: 'start_trigger' } },
      edges: [],
      loops: {},
      parallels: {},
      variables: {
        'variable-1': { id: 'variable-1', name: 'deployed', value: 'frozen' },
      },
      deploymentVersionId: 'deployment-version-1',
    }

    await executeWorkflow(workflow, 'request-1', { prompt: 'hello' }, 'actor-1', {
      enabled: true,
      principal,
      billingAttribution,
      workflowStateOverride,
    })

    const coreParams = executeWorkflowCoreMock.mock.calls[0]?.[0] as {
      snapshot: ExecutionSnapshot
    }
    expect(coreParams.snapshot.metadata.workflowStateOverride).toEqual(workflowStateOverride)
    expect(coreParams.snapshot.workflowVariables).toEqual(workflowStateOverride.variables)
  })

  it('waits for post-execution persistence before resolving', async () => {
    let resolvePostExecution!: () => void
    waitForPostExecutionMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePostExecution = resolve
      })
    )

    let executionSettled = false
    const executionPromise = executeWorkflow(
      workflow,
      'request-1',
      { prompt: 'hello' },
      'actor-1',
      {
        enabled: true,
        principal,
        billingAttribution,
      }
    ).then((result) => {
      executionSettled = true
      return result
    })

    await vi.waitFor(() => expect(waitForPostExecutionMock).toHaveBeenCalledOnce())
    expect(executionSettled).toBe(false)

    resolvePostExecution()
    await executionPromise

    expect(executionSettled).toBe(true)
  })

  it('waits for post-execution persistence before rejecting', async () => {
    const executionError = new Error('Request body size limit exceeded (10MB)')
    executeWorkflowCoreMock.mockRejectedValueOnce(executionError)

    let resolvePostExecution!: () => void
    waitForPostExecutionMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePostExecution = resolve
      })
    )

    let executionSettled = false
    const executionPromise = executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
      enabled: true,
      principal,
      billingAttribution,
    }).catch((error: unknown) => {
      executionSettled = true
      throw error
    })

    await vi.waitFor(() => expect(waitForPostExecutionMock).toHaveBeenCalledOnce())
    expect(executionSettled).toBe(false)

    resolvePostExecution()
    await expect(executionPromise).rejects.toBe(executionError)
    expect(executionSettled).toBe(true)
  })

  /**
   * Post-execution work runs after the core has produced a result and the executor never sees
   * its failure, so this layer is the only one that can carry the result onto it. Callers read a
   * missing result as proof that no block ran — a Copilot run would report an executed workflow
   * as never started and vouch for content it cannot describe.
   */
  it('carries the execution result onto a post-execution failure', async () => {
    const result = { success: true, output: { ran: true }, logs: [] }
    executeWorkflowCoreMock.mockResolvedValueOnce(result)
    handlePostExecutionPauseStateMock.mockRejectedValueOnce(new Error('pause persistence failed'))

    const thrown = await executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
      enabled: true,
      principal,
      billingAttribution,
    }).catch((error: unknown) => error)

    expect(hasExecutionResult(thrown)).toBe(true)
    expect((thrown as { executionResult?: unknown }).executionResult).toBe(result)
  })

  /** A non-Error cannot carry the result, so it is normalized before anything reads it. */
  it('normalizes a non-Error post-execution failure so it can carry the result', async () => {
    const result = { success: true, output: { ran: true }, logs: [] }
    executeWorkflowCoreMock.mockResolvedValueOnce(result)
    handlePostExecutionPauseStateMock.mockRejectedValueOnce('pause persistence exploded')

    const thrown = await executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
      enabled: true,
      principal,
      billingAttribution,
    }).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect(hasExecutionResult(thrown)).toBe(true)
    expect((thrown as { executionResult?: unknown }).executionResult).toBe(result)
  })

  it('transfers post-execution ownership with successful streaming metadata', async () => {
    const result = await executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
      enabled: true,
      principal,
      skipLoggingComplete: true,
      billingAttribution,
    })

    expect(waitForPostExecutionMock).not.toHaveBeenCalled()
    expect(result._streamingMetadata?.loggingSession).toBeDefined()
  })

  it('retains post-execution ownership when streaming execution rejects', async () => {
    const executionError = new Error('Streaming execution failed')
    executeWorkflowCoreMock.mockRejectedValueOnce(executionError)

    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
        principal,
        skipLoggingComplete: true,
        billingAttribution,
      })
    ).rejects.toBe(executionError)

    expect(waitForPostExecutionMock).toHaveBeenCalledOnce()
  })

  it('persists server-issued workflow-group correlation in execution metadata', async () => {
    const correlation = {
      executionId: 'execution-1',
      requestId: 'wfgrp-execution-1',
      source: 'workflow_group' as const,
      workflowId: 'workflow-1',
      triggerType: 'table',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    }

    await executeWorkflow(workflow, 'request-1', { rowId: 'row-1' }, 'actor-1', {
      enabled: true,
      principal,
      workflowTriggerType: 'table',
      billingAttribution,
      trustedExecutionCorrelation: correlation,
    })

    const coreParams = executeWorkflowCoreMock.mock.calls[0]?.[0] as {
      snapshot: ExecutionSnapshot
    }
    expect(coreParams.snapshot.metadata.correlation).toEqual(correlation)
    expect(setTrustedExecutionCorrelationMock).toHaveBeenCalledWith(correlation)
  })

  it('uses the shared diagnostic projection for operational logs and failure telemetry', async () => {
    const secret = 'workflow-telemetry-secret-7f3a91'
    const error = new Error(`failed ${secret} __var_API_KEY __sim_code_1_binding_0`)
    const projectedError = 'failed {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]'
    executeWorkflowCoreMock.mockRejectedValueOnce(error)
    projectDiagnosticErrorMock.mockReturnValueOnce({ error: projectedError, errorName: 'Error' })

    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
        principal,
        billingAttribution,
      })
    ).rejects.toBe(error)

    expect(workflowExecutionLogger.error).toHaveBeenCalledWith(
      '[request-1] Workflow execution failed',
      { error: projectedError, errorName: 'Error' }
    )
    expect(captureServerEventMock).toHaveBeenCalledWith(
      'actor-1',
      'workflow_execution_failed',
      expect.objectContaining({ error_message: projectedError }),
      expect.anything()
    )
    const observabilityPayload = JSON.stringify({
      logger: workflowExecutionLogger.error.mock.calls,
      telemetry: captureServerEventMock.mock.calls,
    })
    expect(observabilityPayload).not.toContain(secret)
    expect(observabilityPayload).not.toContain('__var_')
    expect(observabilityPayload).not.toContain('__sim_')
    expect(error.message).toContain(secret)
  })
})
