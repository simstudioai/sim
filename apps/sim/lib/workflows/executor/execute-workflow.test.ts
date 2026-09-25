import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { loggingSessionMock, loggingSessionMockFns } from '@sim/testing/mocks/logging-session.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionCallbacks } from '@/executor/execution/types'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

const { executeWorkflowCoreMock, handlePostExecutionPauseStateMock } = vi.hoisted(() => ({
  executeWorkflowCoreMock: vi.fn(),
  handlePostExecutionPauseStateMock: vi.fn(),
}))

vi.mock('@sim/utils/id', () => idMock)

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: executeWorkflowCoreMock,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: handlePostExecutionPauseStateMock,
}))

vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { createWorkflowCellProgressWriter } from '@/lib/table/cell-write'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { hasExecutionResult } from '@/executor/utils/errors'

const projectDiagnosticErrorMock = loggingSessionMockFns.mockProjectDiagnosticError
const safeStartMock = loggingSessionMockFns.mockSafeStart
const waitForPostExecutionMock = loggingSessionMockFns.mockWaitForPostExecution
idMockFns.mockGenerateId.mockReturnValue('execution-1')
encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => {
  if (value !== 'encrypted-secret') throw new Error('Invalid ciphertext')
  return { decrypted: 'secret-value' }
})

const workflowExecutionLogger = getMockLogger('WorkflowExecution')

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

const principal = createSessionPrincipal({ userId: 'actor-1' })

describe('executeWorkflow', () => {
  beforeEach(() => {
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
})
