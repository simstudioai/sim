/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'
import { refreshWorkspaceOperation } from '@/lib/workspaces/operations/refresh'

const { receiptTable } = vi.hoisted(() => ({
  receiptTable: {
    id: 'workspaceOperationReceipt.id',
    workspaceId: 'workspaceOperationReceipt.workspaceId',
    report: 'workspaceOperationReceipt.report',
  },
}))
vi.mock('@sim/db/schema', () => ({ ...schemaMock, workspaceOperationReceipt: receiptTable }))

function report(overrides: Partial<WorkspaceOperationReport> = {}): WorkspaceOperationReport {
  return {
    operationId: 'operation',
    requestId: 'request',
    workspaceId: 'workspace',
    kind: 'workspace_push',
    applied: true,
    status: 'processing',
    resourceIds: ['workflow'],
    issues: [],
    ...overrides,
  }
}

function queueReport(value: WorkspaceOperationReport): void {
  queueTableRows(receiptTable, [{ report: value }])
}

describe('refreshWorkspaceOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([null, {}, { triggers: { status: 'pending', updatedAt: '2026-09-09T00:00:00Z' } }])(
    'fails terminal deployment readiness that cannot be verified: %j',
    async (readiness) => {
      queueReport(report({ deploymentOperationIds: ['deployment'] }))
      queueTableRows(schemaMock.workflowDeploymentOperation, [
        { id: 'deployment', workflowId: 'workflow', version: 1, status: 'active', readiness },
      ])
      const result = await refreshWorkspaceOperation('workspace', 'operation')
      expect(result).toMatchObject({
        status: 'failed',
        completionRecorded: true,
        deployments: [{ ready: false }],
        issues: [{ code: 'deployment_readiness_invalid' }],
      })
    }
  )

  it('keeps a failed effect visible without freezing another pending effect', async () => {
    const current = report({ effectEventIds: ['failed', 'pending'] })
    queueReport(current)
    queueTableRows(schemaMock.outboxEvent, [
      { id: 'failed', status: 'dead_letter' },
      { id: 'pending', status: 'processing' },
    ])
    expect(await refreshWorkspaceOperation('workspace', 'operation')).toMatchObject({
      status: 'processing',
      completionRecorded: false,
      issues: [{ code: 'follow_up_failed' }],
    })
    queueReport(current)
    queueTableRows(schemaMock.outboxEvent, [
      { id: 'failed', status: 'dead_letter' },
      { id: 'pending', status: 'completed' },
    ])
    expect(await refreshWorkspaceOperation('workspace', 'operation')).toMatchObject({
      status: 'failed',
      completionRecorded: true,
      issues: [{ code: 'follow_up_failed' }],
    })
    expect(current.issues).toHaveLength(1)
  })

  it('waits for a real deployment attempt even when another effect has failed', async () => {
    queueReport(report({ deploymentOperationIds: ['deployment'], effectEventIds: ['failed'] }))
    queueTableRows(schemaMock.workflowDeploymentOperation, [
      {
        id: 'deployment',
        workflowId: 'workflow',
        version: 1,
        status: 'preparing',
        readiness: { triggers: { status: 'pending', updatedAt: '2026-09-09T00:00:00Z' } },
      },
    ])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'failed', status: 'dead_letter' }])
    expect(await refreshWorkspaceOperation('workspace', 'operation')).toMatchObject({
      status: 'processing',
      completionRecorded: false,
    })
  })

  it('allows an unfinished deployment to establish readiness before deciding its terminal result', async () => {
    const current = report({ deploymentOperationIds: ['deployment'] })
    queueReport(current)
    queueTableRows(schemaMock.workflowDeploymentOperation, [
      {
        id: 'deployment',
        workflowId: 'workflow',
        version: 1,
        status: 'preparing',
        readiness: null,
      },
    ])
    expect(await refreshWorkspaceOperation('workspace', 'operation')).toMatchObject({
      status: 'processing',
      completionRecorded: false,
      issues: [],
      deployments: [{ ready: false }],
    })
    queueReport(current)
    queueTableRows(schemaMock.workflowDeploymentOperation, [
      {
        id: 'deployment',
        workflowId: 'workflow',
        version: 1,
        status: 'active',
        readiness: { triggers: { status: 'ready', updatedAt: '2026-09-09T00:00:00Z' } },
      },
    ])
    expect(await refreshWorkspaceOperation('workspace', 'operation')).toMatchObject({
      status: 'completed',
      completionRecorded: true,
      issues: [],
      deployments: [{ ready: true }],
    })
  })

  it('records an abandoned copy as failed while preserving the committed receipt', async () => {
    queueReport(
      report({
        copyProgress: { status: 'pending', copied: 2, failed: 0 },
        contentOutboxEventId: 'copy',
      })
    )
    queueTableRows(schemaMock.outboxEvent, [{ status: 'completed' }])
    expect(await refreshWorkspaceOperation('workspace', 'operation')).toMatchObject({
      applied: true,
      status: 'failed',
      completionRecorded: true,
      copyProgress: { status: 'failed', copied: 2, failed: 1 },
    })
  })

  it('returns a completed receipt without rereading effects or changing it', async () => {
    const current = report({ status: 'completed', completionRecorded: true })
    queueReport(current)
    expect(await refreshWorkspaceOperation('workspace', 'operation')).toEqual(current)
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
