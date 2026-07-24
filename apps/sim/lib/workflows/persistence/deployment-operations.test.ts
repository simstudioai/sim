/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateId } = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  workflow: schemaMock.workflow,
  workflowDeploymentOperation: schemaMock.workflowDeploymentOperation,
  workflowDeploymentVersion: schemaMock.workflowDeploymentVersion,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

import {
  activateDeploymentOperation,
  markDeploymentComponentReadiness,
  markDeploymentOperationFailed,
  prepareWorkflowDeployment,
} from '@/lib/workflows/persistence/deployment-operations'

const WORKFLOW_ID = 'workflow-1'
const NOW = new Date('2026-07-14T08:00:00.000Z')

function operationRow(
  overrides: Partial<{
    id: string
    workflowId: string
    deploymentVersionId: string
    version: number
    previousActiveVersionId: string | null
    action: 'deploy' | 'activate'
    protocolVersion: number
    generation: number
    status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
    componentReadiness: Record<string, unknown>
    errorCode: string | null
    errorMessage: string | null
    idempotencyKey: string | null
    requestHash: string
    actorId: string
    completedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }> = {}
) {
  return {
    id: 'operation-1',
    workflowId: WORKFLOW_ID,
    deploymentVersionId: 'version-2',
    version: 2,
    previousActiveVersionId: 'version-1',
    action: 'deploy' as const,
    protocolVersion: 2,
    generation: 2,
    status: 'preparing' as const,
    componentReadiness: {},
    errorCode: null,
    errorMessage: null,
    idempotencyKey: null,
    requestHash: 'request-hash',
    actorId: 'user-1',
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function workflowState() {
  return {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
    lastSaved: NOW.getTime(),
  }
}

function scriptPrepare(params: {
  operation: ReturnType<typeof operationRow>
  activeVersionId: string | null
  maxVersion: number
  maxGeneration: number
}) {
  dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
  dbChainMockFns.limit
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(params.activeVersionId ? [{ id: params.activeVersionId }] : [])
    .mockResolvedValueOnce([{ maxVersion: params.maxVersion }])
    .mockResolvedValueOnce([{ maxGeneration: params.maxGeneration }])
  dbChainMockFns.returning.mockResolvedValueOnce([params.operation])
}

describe('deployment operation persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGenerateId.mockReset()
  })

  it('creates first-deploy and redeploy snapshots inactive while generations supersede rapidly', async () => {
    const firstOperation = operationRow({
      id: 'operation-1',
      deploymentVersionId: 'version-1',
      version: 1,
      previousActiveVersionId: null,
      generation: 1,
    })
    const secondOperation = operationRow({
      id: 'operation-2',
      deploymentVersionId: 'version-2',
      version: 2,
      previousActiveVersionId: 'version-live',
      generation: 2,
    })
    mockGenerateId
      .mockReturnValueOnce('version-1')
      .mockReturnValueOnce('operation-1')
      .mockReturnValueOnce('version-2')
      .mockReturnValueOnce('operation-2')
    scriptPrepare({
      operation: firstOperation,
      activeVersionId: null,
      maxVersion: 0,
      maxGeneration: 0,
    })
    scriptPrepare({
      operation: secondOperation,
      activeVersionId: 'version-live',
      maxVersion: 1,
      maxGeneration: 1,
    })

    const first = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'hash-1',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
      readinessComponents: ['webhooks'],
    })
    const second = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'hash-2',
      idempotencyKey: 'deploy-2',
      workflowState: workflowState(),
      readinessComponents: ['webhooks'],
    })

    expect(first).toEqual({ success: true, operation: firstOperation, reused: false })
    expect(second).toEqual({ success: true, operation: secondOperation, reused: false })

    const insertedValues = dbChainMockFns.values.mock.calls.map(([values]) => values)
    expect(insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'version-1',
          version: 1,
          isActive: false,
        }),
        expect.objectContaining({
          id: 'operation-1',
          generation: 1,
          previousActiveVersionId: null,
          status: 'preparing',
        }),
        expect.objectContaining({
          id: 'version-2',
          version: 2,
          isActive: false,
        }),
        expect.objectContaining({
          id: 'operation-2',
          generation: 2,
          previousActiveVersionId: 'version-live',
          status: 'preparing',
        }),
      ])
    )
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'superseded' })
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.workflow)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.workflowDeploymentVersion)
  })

  it('runs the prepare callback in the operation transaction after insertion', async () => {
    const operation = operationRow({
      deploymentVersionId: 'version-1',
      version: 1,
      previousActiveVersionId: null,
      generation: 1,
    })
    const onPrepareTransaction = vi.fn().mockResolvedValue(undefined)
    mockGenerateId.mockReturnValueOnce('version-1').mockReturnValueOnce('operation-1')
    scriptPrepare({
      operation,
      activeVersionId: null,
      maxVersion: 0,
      maxGeneration: 0,
    })

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'hash-1',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
      readinessComponents: ['webhooks'],
      onPrepareTransaction,
    })

    expect(result.success).toBe(true)
    expect(onPrepareTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ insert: expect.any(Function) }),
      operation
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of an idempotency key with a different request hash', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
    dbChainMockFns.limit.mockResolvedValueOnce([
      operationRow({ idempotencyKey: 'deploy-1', requestHash: 'original-hash' }),
    ])

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'different-hash',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
    })

    expect(result).toEqual({
      success: false,
      reason: 'idempotency_conflict',
      error: 'Idempotency key was already used for a different deployment request',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('reuses an in-flight operation for a duplicate request', async () => {
    const inFlight = operationRow({
      idempotencyKey: 'deploy-1',
      requestHash: 'hash-1',
      status: 'preparing',
    })
    dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
    dbChainMockFns.limit.mockResolvedValueOnce([inFlight])

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'hash-1',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
    })

    expect(result).toEqual({ success: true, operation: inFlight, reused: true })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('releases a spent idempotency key and admits a fresh attempt after a failed operation', async () => {
    const failed = operationRow({
      id: 'operation-failed',
      idempotencyKey: 'deploy-1',
      requestHash: 'hash-1',
      status: 'failed',
      generation: 2,
    })
    const fresh = operationRow({ id: 'operation-fresh', generation: 3 })
    mockGenerateId.mockReturnValueOnce('version-fresh').mockReturnValueOnce('operation-fresh')
    dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([failed])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ maxVersion: 2 }])
      .mockResolvedValueOnce([{ maxGeneration: 2 }])
    dbChainMockFns.returning.mockResolvedValueOnce([fresh])

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'hash-1',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
      readinessComponents: ['webhooks'],
    })

    expect(result).toEqual({ success: true, operation: fresh, reused: false })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null })
    )
    expect(dbChainMockFns.insert).toHaveBeenCalled()
  })

  /**
   * Callers scope one idempotency key to a whole request (the deploy orchestrator
   * passes `requestId`), so a single request that deploys the same workflow twice —
   * e.g. the agent redeploying after edits within one chat request — presents the
   * same key with a new request hash. Once the first deployment settled, the key
   * must be reassignable or that caller is locked out permanently.
   */
  it('releases the key of a completed (active) operation when the request differs', async () => {
    const completed = operationRow({
      id: 'operation-active',
      idempotencyKey: 'deploy-1',
      requestHash: 'original-hash',
      status: 'active',
      generation: 2,
    })
    const fresh = operationRow({ id: 'operation-fresh', generation: 3 })
    mockGenerateId.mockReturnValueOnce('version-fresh').mockReturnValueOnce('operation-fresh')
    dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([completed])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ maxVersion: 2 }])
      .mockResolvedValueOnce([{ maxGeneration: 2 }])
    dbChainMockFns.returning.mockResolvedValueOnce([fresh])

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'different-hash',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
      readinessComponents: ['webhooks'],
    })

    expect(result).toEqual({ success: true, operation: fresh, reused: false })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null })
    )
    expect(dbChainMockFns.insert).toHaveBeenCalled()
  })

  it('releases the key of a failed operation even when the request differs', async () => {
    const failed = operationRow({
      id: 'operation-failed',
      idempotencyKey: 'deploy-1',
      requestHash: 'original-hash',
      status: 'failed',
      generation: 2,
    })
    const fresh = operationRow({ id: 'operation-fresh', generation: 3 })
    mockGenerateId.mockReturnValueOnce('version-fresh').mockReturnValueOnce('operation-fresh')
    dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([failed])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ maxVersion: 2 }])
      .mockResolvedValueOnce([{ maxGeneration: 2 }])
    dbChainMockFns.returning.mockResolvedValueOnce([fresh])

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'different-hash',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
      readinessComponents: ['webhooks'],
    })

    expect(result).toEqual({ success: true, operation: fresh, reused: false })
    expect(dbChainMockFns.insert).toHaveBeenCalled()
  })

  it('still rejects a different request while an operation is mid-activation', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
    dbChainMockFns.limit.mockResolvedValueOnce([
      operationRow({
        idempotencyKey: 'deploy-1',
        requestHash: 'original-hash',
        status: 'activating',
      }),
    ])

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'different-hash',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
    })

    expect(result).toEqual({
      success: false,
      reason: 'idempotency_conflict',
      error: 'Idempotency key was already used for a different deployment request',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('reuses a completed (active) operation for a true duplicate request', async () => {
    const completed = operationRow({
      idempotencyKey: 'deploy-1',
      requestHash: 'hash-1',
      status: 'active',
    })
    dbChainMockFns.for.mockResolvedValueOnce([{ id: WORKFLOW_ID, archivedAt: null }])
    dbChainMockFns.limit.mockResolvedValueOnce([completed])

    const result = await prepareWorkflowDeployment({
      workflowId: WORKFLOW_ID,
      actorId: 'user-1',
      requestHash: 'hash-1',
      idempotencyKey: 'deploy-1',
      workflowState: workflowState(),
    })

    expect(result).toEqual({ success: true, operation: completed, reused: true })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects stale generation callbacks before mutating legacy deployment state', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([{ id: WORKFLOW_ID }])
      .mockResolvedValueOnce([
        operationRow({ status: 'activating', generation: 4, componentReadiness: {} }),
      ])
    dbChainMockFns.limit.mockResolvedValueOnce([{ maxGeneration: 5 }])

    const result = await activateDeploymentOperation({
      workflowId: WORKFLOW_ID,
      operationId: 'operation-1',
      generation: 4,
    })

    expect(result).toEqual({
      success: false,
      reason: 'stale_generation',
      error: 'Deployment operation generation is stale',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('uses operation and generation CAS for component readiness', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await markDeploymentComponentReadiness({
      workflowId: WORKFLOW_ID,
      operationId: 'operation-1',
      generation: 1,
      component: 'webhooks',
      status: 'ready',
    })

    expect(result).toEqual({
      success: false,
      reason: 'stale_generation',
      error: 'Deployment operation generation or component state is stale',
    })
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.workflowDeploymentOperation)
  })

  it('marks failure without changing the previously active deployment', async () => {
    const failedOperation = operationRow({
      status: 'failed',
      errorCode: 'provider_failed',
      errorMessage: 'authorization=[redacted]',
      completedAt: NOW,
    })
    dbChainMockFns.returning.mockResolvedValueOnce([failedOperation])

    const result = await markDeploymentOperationFailed({
      workflowId: WORKFLOW_ID,
      operationId: 'operation-1',
      generation: 2,
      errorCode: 'provider_failed',
      error: new Error('authorization=secret'),
    })

    expect(result).toEqual({ success: true, operation: failedOperation })
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.workflowDeploymentOperation)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.workflow)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.workflowDeploymentVersion)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'provider_failed',
        errorMessage: 'authorization=[redacted]',
      })
    )
  })

  it('refuses activation while any required component is pending', async () => {
    const operation = operationRow({
      status: 'activating',
      componentReadiness: {
        webhooks: { status: 'ready', updatedAt: NOW.toISOString() },
        schedules: { status: 'pending', updatedAt: NOW.toISOString() },
      },
    })
    dbChainMockFns.for
      .mockResolvedValueOnce([{ id: WORKFLOW_ID }])
      .mockResolvedValueOnce([operation])
    dbChainMockFns.limit.mockResolvedValueOnce([{ maxGeneration: 2 }])

    const result = await activateDeploymentOperation({
      workflowId: WORKFLOW_ID,
      operationId: operation.id,
      generation: operation.generation,
    })

    expect(result).toEqual({
      success: false,
      reason: 'not_ready',
      error: 'Deployment operation components are not all ready',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('atomically flips compatibility fields only for an all-ready current operation', async () => {
    const operation = operationRow({
      status: 'activating',
      componentReadiness: {
        webhooks: { status: 'ready', updatedAt: NOW.toISOString() },
        schedules: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    dbChainMockFns.for
      .mockResolvedValueOnce([{ id: WORKFLOW_ID }])
      .mockResolvedValueOnce([operation])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ maxGeneration: 2 }])
      .mockResolvedValueOnce([{ id: 'version-1' }])
      .mockResolvedValueOnce([{ id: 'version-2' }])
    const onActivateTransaction = vi.fn().mockResolvedValue(undefined)

    const result = await activateDeploymentOperation({
      workflowId: WORKFLOW_ID,
      operationId: operation.id,
      generation: operation.generation,
      onActivateTransaction,
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.update.mock.calls.map(([table]) => table)).toEqual([
      schemaMock.workflowDeploymentVersion,
      schemaMock.workflow,
      schemaMock.workflowDeploymentOperation,
    ])
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
      isActive: expect.objectContaining({ values: expect.arrayContaining(['version-2']) }),
    })
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ isDeployed: true, deployedAt: expect.any(Date) })
    )
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        status: 'active',
        completedAt: expect.any(Date),
      })
    )
    expect(onActivateTransaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
  })

  it('does not activate after a legacy writer changes the active deployment', async () => {
    const operation = operationRow({
      status: 'activating',
      componentReadiness: {
        webhooks: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    dbChainMockFns.for
      .mockResolvedValueOnce([{ id: WORKFLOW_ID }])
      .mockResolvedValueOnce([operation])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ maxGeneration: operation.generation }])
      .mockResolvedValueOnce([{ id: 'version-written-by-legacy-pod' }])

    const result = await activateDeploymentOperation({
      workflowId: WORKFLOW_ID,
      operationId: operation.id,
      generation: operation.generation,
    })

    expect(result).toEqual({
      success: false,
      reason: 'stale_generation',
      error: 'Active deployment changed while this operation was preparing',
    })
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.workflowDeploymentOperation)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'superseded', completedAt: expect.any(Date) })
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.workflowDeploymentVersion)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.workflow)
  })
})
