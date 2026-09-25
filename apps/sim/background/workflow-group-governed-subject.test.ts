import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  billingUsageGateCacheMock,
  billingUsageGateCacheMockFns,
} from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import {
  executeWorkflowMock,
  executeWorkflowMockFns,
} from '@sim/testing/mocks/execute-workflow.mock'
import {
  executionPreprocessingMock,
  executionPreprocessingMockFns,
} from '@sim/testing/mocks/execution-preprocessing.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import {
  tableRowsSecretProvenanceMock,
  tableRowsSecretProvenanceMockFns,
} from '@sim/testing/mocks/table-rows-secret-provenance.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  writeWorkflowGroupState: vi.fn(),
  markWorkflowGroupPickedUp: vi.fn(),
  createWorkflowCellProgressWriter: vi.fn(),
  findStartBlock: vi.fn(),
  flattenWorkflowOutputs: vi.fn(),
  normalizeInputFormatValue: vi.fn(),
}))

vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/table/cell-write', () => ({
  buildCancelledExecution: (prev: { executionId: string | null; workflowId: string }) => ({
    status: 'cancelled',
    executionId: prev.executionId,
    jobId: null,
    workflowId: prev.workflowId,
    error: 'Cancelled',
  }),
  createWorkflowCellProgressWriter: hoisted.createWorkflowCellProgressWriter,
  writeWorkflowGroupState: hoisted.writeWorkflowGroupState,
  markWorkflowGroupPickedUp: hoisted.markWorkflowGroupPickedUp,
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: () => ({ status: 'completed', error: null }),
}))
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/dispatcher', () => ({
  readDispatch: async () => ({ id: 'tdsp_1', status: 'dispatching' }),
  completeDispatchIfActive: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/workflows/executor/execute-workflow', () => executeWorkflowMock)
vi.mock('@/lib/workflows/triggers/triggers', () => ({
  TriggerUtils: { findStartBlock: hoisted.findStartBlock },
}))
vi.mock('@/lib/workflows/blocks/flatten-outputs', () => ({
  flattenWorkflowOutputs: hoisted.flattenWorkflowOutputs,
}))
vi.mock('@/lib/workflows/input-format', () => ({
  normalizeInputFormatValue: hoisted.normalizeInputFormatValue,
}))
vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/table/admission-retry', () => ({
  retryTableAdmission: (fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/table/rows/secret-provenance', () => tableRowsSecretProvenanceMock)
vi.mock('@/executor/utils/resolved-secret-trace-registry', () => ({
  ResolvedSecretTraceRegistry: class {
    importCrossingProvenance = vi.fn()
    exportCheckpointProvenance = vi.fn(() => undefined)
  },
}))
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)
/** Real pacing would sleep jittered backoff against the global db mock. */
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitWithSubscription = vi.fn().mockResolvedValue({ allowed: true })
  },
}))

import { runRowCascadeLoop } from '@/background/workflow-column-execution'

billingUsageGateCacheMockFns.mockCheckExecutionUsageLimits.mockResolvedValue({ isExceeded: false })

const mocks = {
  ...hoisted,
  executeWorkflow: executeWorkflowMockFns.mockExecuteWorkflow,
  getRowById: tableRowsServiceMockFns.mockGetRowById,
  getRowSummaryById: tableRowsServiceMockFns.mockGetRowSummaryById,
  createProvenanceReader: tableRowsSecretProvenanceMockFns.mockTableRowProvenanceReader,
  exportProvenance: tableRowsSecretProvenanceMockFns.mockTableRowProvenanceReaderExportProvenance,
  pickNextEligibleGroupForRow: tableWorkflowColumnsMockFns.mockPickNextEligibleGroupForRow,
  stashCellContextForResume: tableWorkflowColumnsMockFns.mockStashCellContextForResume,
}

const mockGetTableById = tableServiceMockFns.mockGetTableById
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState
const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution
billingAttributionMockFns.mockToBillingContext.mockReturnValue({} as never)

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
    resetDbChainMock()
    tableWorkflowColumnsMockFns.mockBuildWorkflowGroupExecutionCorrelation.mockReturnValue(
      {} as never
    )
    tableRowsSecretProvenanceMockFns.mockCreateExactEmptyTableRowSecretProvenance.mockReturnValue({
      complete: true,
      columns: {},
    })
    mocks.getRowSummaryById.mockImplementation((tableId, rowId, workspaceId) =>
      mocks.getRowById(tableId, rowId, workspaceId)
    )
    mocks.flattenWorkflowOutputs.mockReturnValue([])
    mocks.normalizeInputFormatValue.mockReturnValue([])
    mockGetTableById.mockResolvedValue(TABLE)
    mocks.getRowById.mockResolvedValue({
      id: 'row-1',
      data: {},
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      executions: {},
    })
    mocks.pickNextEligibleGroupForRow.mockReturnValue(null)
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    mocks.markWorkflowGroupPickedUp.mockResolvedValue('picked-up')
    mockLoadDeployedWorkflowState.mockResolvedValue({ blocks: {}, edges: [] })
    mocks.findStartBlock.mockReturnValue({ blockId: 'start-1', block: { subBlocks: {} } })
    mocks.exportProvenance.mockReturnValue({
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
    mockPreprocessExecution.mockResolvedValue({
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

  it.each([false, true])(
    'captures fresh workflow inputs and explicit output mappings (%s)',
    async (mapOutput) => {
      const group = {
        ...GROUP,
        outputs: [{ columnName: 'col-output', blockId: 'agent', path: 'content' }],
        inputMappings: mapOutput ? [{ columnName: 'col-output', inputName: 'explicit' }] : [],
      }
      mocks.flattenWorkflowOutputs.mockReturnValue([{ blockId: 'agent', path: 'content' }])
      mocks.normalizeInputFormatValue.mockReturnValue([{ name: 'explicit' }])
      mockGetTableById.mockResolvedValue({
        ...TABLE,
        schema: {
          columns: [
            { id: 'col-input', name: 'Input', type: 'string' },
            { id: 'col-output', name: 'Output', type: 'string' },
          ],
          workflowGroups: [group],
        },
      })
      mocks.getRowSummaryById.mockResolvedValue({
        id: 'row-1',
        data: { 'col-input': 'current-value', 'col-output': 'output-secret' },
        updatedAt: new Date('2026-09-14T00:00:00Z'),
      })

      await runRowCascadeLoop(PAYLOAD)

      expect(mocks.createProvenanceReader).toHaveBeenCalledExactlyOnceWith(
        { userId: 'workflow-owner', workspaceId: 'workspace-1' },
        new Set(mapOutput ? ['col-input', 'col-output'] : ['col-input'])
      )
      const input = mocks.executeWorkflow.mock.calls[0][2]
      expect(input.row).toEqual({ Input: 'current-value' })
      expect(input.rawRow).toEqual(input.row)
      expect(input.headers).toEqual(['Input'])
      if (mapOutput) expect(input.explicit).toBe('output-secret')
      else expect(input.Input).toBe('current-value')
      expect(mocks.markWorkflowGroupPickedUp.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.getRowSummaryById.mock.invocationCallOrder[0]
      )
      expect(mocks.getRowSummaryById.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.executeWorkflow.mock.invocationCallOrder[0]
      )
    }
  )

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

  /**
   * Account deletion terminalizes the departing person's still-unstarted
   * markers with the canonical cancel. This is the guard that makes that stick:
   * the sibling dispatch that would otherwise drain the marker ungated reads
   * the cell's own state before running anything.
   */
  it('refuses a marker another path terminalized before pickup', async () => {
    mocks.getRowById.mockResolvedValue({
      id: 'row-1',
      data: {},
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      executions: {
        'group-1': {
          status: 'cancelled',
          executionId: null,
          jobId: null,
          workflowId: 'workflow-1',
          error: 'Cancelled',
          cancelledAt: '2026-08-28T00:00:00.000Z',
        },
      },
    })

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.executeWorkflow).not.toHaveBeenCalled()
    expect(mocks.markWorkflowGroupPickedUp).not.toHaveBeenCalled()
  }, 20_000)
})
