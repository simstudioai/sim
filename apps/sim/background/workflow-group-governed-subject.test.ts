/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTableById: vi.fn(),
  getRowById: vi.fn(),
  pickNextEligibleGroupForRow: vi.fn(),
  stashCellContextForResume: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  markWorkflowGroupPickedUp: vi.fn(),
  createWorkflowCellProgressWriter: vi.fn(),
  loadDeployedWorkflowState: vi.fn(),
  executeWorkflow: vi.fn(),
  preprocessExecution: vi.fn(),
  loadTableRowSecretProvenance: vi.fn(),
  findStartBlock: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))
vi.mock('@/lib/table/rows/service', () => ({
  getRowById: mocks.getRowById,
  updateRow: vi.fn(),
}))
vi.mock('@/lib/table/workflow-columns', () => ({
  pickNextEligibleGroupForRow: mocks.pickNextEligibleGroupForRow,
  stashCellContextForResume: mocks.stashCellContextForResume,
  buildWorkflowGroupExecutionCorrelation: () => ({}),
}))
vi.mock('@/lib/table/cell-write', () => ({
  buildCancelledExecution: (prev: { executionId: string | null; workflowId: string }) => ({
    status: 'cancelled',
    executionId: prev.executionId,
    jobId: null,
    workflowId: prev.workflowId,
    error: 'Cancelled',
  }),
  createWorkflowCellProgressWriter: mocks.createWorkflowCellProgressWriter,
  writeWorkflowGroupState: mocks.writeWorkflowGroupState,
  markWorkflowGroupPickedUp: mocks.markWorkflowGroupPickedUp,
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: () => ({ status: 'completed', error: null }),
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))
vi.mock('@/lib/table/dispatcher', () => ({
  readDispatch: async () => ({ id: 'tdsp_1', status: 'dispatching' }),
  completeDispatchIfActive: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mocks.loadDeployedWorkflowState,
}))
vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: mocks.executeWorkflow,
}))
vi.mock('@/lib/workflows/triggers/triggers', () => ({
  TriggerUtils: { findStartBlock: mocks.findStartBlock },
}))
vi.mock('@/lib/workflows/blocks/flatten-outputs', () => ({ flattenWorkflowOutputs: () => [] }))
vi.mock('@/lib/workflows/input-format', () => ({ normalizeInputFormatValue: () => [] }))
vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: mocks.preprocessExecution,
}))
vi.mock('@/lib/table/admission-retry', () => ({
  retryTableAdmission: (fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createExactEmptyTableRowSecretProvenance: () => ({ complete: true, columns: {} }),
  createTableRowSecretProvenanceFromRegistry: () => ({ complete: true, columns: {} }),
  loadTableRowSecretProvenance: mocks.loadTableRowSecretProvenance,
}))
vi.mock('@/executor/utils/resolved-secret-trace-registry', () => ({
  ResolvedSecretTraceRegistry: class {
    importCrossingProvenance = vi.fn()
    exportCheckpointProvenance = vi.fn(() => undefined)
  },
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: (snapshot: unknown) => snapshot,
  checkAttributedUsageLimits: async () => ({ isExceeded: false }),
  toBillingContext: () => ({}),
}))
/** Real pacing would sleep jittered backoff against the global db mock. */
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitWithSubscription = vi.fn().mockResolvedValue({ allowed: true })
  },
}))

import { runRowCascadeLoop } from '@/background/workflow-column-execution'

const GROUP = {
  id: 'group-1',
  type: 'workflow',
  workflowId: 'workflow-1',
  outputs: [],
  inputMappings: [],
}
const TABLE = {
  id: 'table-1',
  name: 'Table',
  workspaceId: 'workspace-1',
  schema: { columns: [], workflowGroups: [GROUP] },
}

const BILLING = {
  actorUserId: 'workspace-billing-owner',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-billing-owner',
  billingEntity: { type: 'user' as const, id: 'workspace-billing-owner' },
  billingPeriod: { start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
  payerSubscription: null,
}

/**
 * A workspace-API-key run: the attribution names the workspace's billing owner,
 * while the person who actually asked is the governed subject.
 */
const PAYLOAD = {
  tableId: 'table-1',
  tableName: 'Table',
  rowId: 'row-1',
  groupId: 'group-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  dispatchId: 'tdsp_1',
  executionTimeoutMs: 10_000,
  triggeredByUserId: 'workspace-billing-owner',
  capabilityGovernedUserId: 'requesting-member',
  billingAttribution: BILLING,
} as Parameters<typeof runRowCascadeLoop>[0]

describe('the workflow half of a table cell', () => {
  /** The cell resolves its collaborators with dynamic imports; warm them once. */
  beforeAll(async () => {
    await Promise.all([
      import('@/lib/table/cell-write'),
      import('@/lib/table/dispatcher'),
      import('@/lib/table/rows/service'),
      import('@/lib/table/service'),
      import('@/lib/table/workflow-columns'),
      import('@/lib/workflows/executor/execute-workflow'),
      import('@/lib/workflows/persistence/utils'),
    ])
  }, 60_000)

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getTableById.mockResolvedValue(TABLE)
    mocks.getRowById.mockResolvedValue({
      id: 'row-1',
      data: {},
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      executions: {},
    })
    mocks.pickNextEligibleGroupForRow.mockReturnValue(null)
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    mocks.markWorkflowGroupPickedUp.mockResolvedValue('picked-up')
    mocks.loadDeployedWorkflowState.mockResolvedValue({ blocks: {}, edges: [] })
    mocks.findStartBlock.mockReturnValue({ blockId: 'start-1', block: { subBlocks: {} } })
    mocks.loadTableRowSecretProvenance.mockResolvedValue({
      scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
      byRowId: {},
    })
    mocks.createWorkflowCellProgressWriter.mockReturnValue({
      onBlockStart: vi.fn(),
      onBlockComplete: vi.fn(),
      finish: vi.fn(),
      getEventOutputs: () => ({}),
      getPendingDataPatch: () => ({}),
      getBlockErrors: () => ({}),
      getPendingSecretProvenance: () => undefined,
    })
    mocks.preprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'workspace-billing-owner',
      actorSubscription: null,
      billingAttribution: BILLING,
    })
    mocks.executeWorkflow.mockResolvedValue({ success: true, status: 'completed', output: {} })
    /** The workflow record read. */
    dbChainMockFns.limit.mockResolvedValue([
      {
        id: 'workflow-1',
        userId: 'workflow-owner',
        workspaceId: 'workspace-1',
        variables: {},
      },
    ])
  })

  /**
   * The gate and the meter are different people on a workspace-key run. Gating
   * on the billing owner applies a bystander's denylist and skips the
   * requester's — the exact defect the enrichment half of this worker was fixed
   * for.
   */
  it('gates on the governed subject while still billing the attributed actor', async () => {
    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.executeWorkflow).toHaveBeenCalledTimes(1)
    const [workflow, , , actorUserId, options] = mocks.executeWorkflow.mock.calls[0]
    expect(options.capabilityGovernedUserId).toBe('requesting-member')
    // Untouched: billing actor, credential/env subject, and payer snapshot.
    expect(actorUserId).toBe('workspace-billing-owner')
    expect(workflow.userId).toBe('workflow-owner')
    expect(options.billingAttribution).toBe(BILLING)
  }, 20_000)

  it('declares an explicit null for an actorless auto-fire', async () => {
    await runRowCascadeLoop({ ...PAYLOAD, capabilityGovernedUserId: null })

    const [, , , , options] = mocks.executeWorkflow.mock.calls[0]
    expect(options.capabilityGovernedUserId).toBeNull()
  }, 20_000)

  /** The subject has to survive the pause — nothing downstream can re-derive it. */
  it('stashes the governed subject with the pause context', async () => {
    mocks.executeWorkflow.mockResolvedValue({ success: true, status: 'paused', output: {} })

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.stashCellContextForResume).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        groupId: 'group-1',
        capabilityGovernedUserId: 'requesting-member',
      })
    )
  }, 20_000)
})
