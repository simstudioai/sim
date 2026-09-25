import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { triggerSdkMockFns } from '@sim/testing/mocks/trigger-sdk.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import type {
  RowExecutionMetadata,
  TableDefinition,
  TableRow,
  WorkflowGroup,
} from '@/lib/table/types'

const {
  mockGetJobQueue,
  mockListActiveDispatches,
  mockMarkActiveDispatchesCancelled,
  mockQueueCancelByKey,
  mockQueueCancelJob,
} = vi.hoisted(() => ({
  mockGetJobQueue: vi.fn(),
  mockListActiveDispatches: vi.fn(),
  mockMarkActiveDispatchesCancelled: vi.fn(),
  mockQueueCancelByKey: vi.fn(),
  mockQueueCancelJob: vi.fn(),
}))

const SYSTEM_BILLING_ATTRIBUTION = {
  actorUserId: 'owner-after-transfer',
  workspaceId: 'workspace-1',
  organizationId: 'org-after-transfer',
  billedAccountUserId: 'owner-after-transfer',
  billingEntity: { type: 'organization' as const, id: 'org-after-transfer' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/core/async-jobs/config', () => ({
  getJobQueue: mockGetJobQueue,
}))

vi.mock('@/lib/table/dispatcher', () => ({
  listActiveDispatches: mockListActiveDispatches,
  markActiveDispatchesCancelled: mockMarkActiveDispatchesCancelled,
}))

vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)

vi.mock('@/lib/table/service', () => tableServiceMock)

import {
  assertWorkflowGroupsDeployable,
  buildEnqueueItems,
  cancelCellRunsByTags,
  cancelWorkflowGroupRuns,
  pickNextEligibleGroupForRow,
  runWorkflowColumn,
  type WorkflowGroupCellPayload,
} from '@/lib/table/workflow-columns'

const { mockRunsCancel, mockRunsList } = triggerSdkMockFns
const mockUpdateRow = tableRowsServiceMockFns.mockUpdateRow

const mockResolveBillingAttribution = billingAttributionMockFns.mockResolveBillingAttribution
const mockResolveSystemBillingAttribution =
  billingAttributionMockFns.mockResolveSystemBillingAttribution
const mockGetTableById = tableServiceMockFns.mockGetTableById

beforeEach(() => {
  resetDbChainMock()
  mockGetJobQueue.mockResolvedValue({
    cancelByKey: mockQueueCancelByKey,
    cancelJob: mockQueueCancelJob,
  })
  mockListActiveDispatches.mockResolvedValue([])
  mockMarkActiveDispatchesCancelled.mockResolvedValue([])
  mockResolveBillingAttribution.mockImplementation(
    ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) =>
      Promise.resolve({
        actorUserId,
        workspaceId,
        organizationId: 'org-1',
        billedAccountUserId: 'workspace-owner',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
      })
  )
  mockResolveSystemBillingAttribution.mockResolvedValue(SYSTEM_BILLING_ATTRIBUTION)
})

function makeGroup(overrides: Partial<WorkflowGroup> & { id: string }): WorkflowGroup {
  return {
    workflowId: `wf-${overrides.id}`,
    outputs: [{ blockId: 'b1', path: 'out', columnName: `${overrides.id}_out` }],
    ...overrides,
  }
}

function makeTable(groups: WorkflowGroup[]): TableDefinition {
  return {
    id: 'tbl1',
    name: 'T',
    schema: { columns: [], workflowGroups: groups },
    rowCount: 1,
    maxRows: 1000,
    workspaceId: 'ws1',
    createdBy: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeRow(
  executions: Record<string, RowExecutionMetadata>,
  data: Record<string, unknown> = {}
): TableRow {
  return {
    id: 'row1',
    data: data as TableRow['data'],
    executions,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/** The dispatcher's "queued marker" pre-stamp: pending with no executionId. */
function queuedMarker(workflowId: string): RowExecutionMetadata {
  return { status: 'pending', executionId: null, jobId: null, workflowId, error: null }
}

beforeAll(() => {
  setEnvFlags({ isTriggerDevEnabled: true, isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('pickNextEligibleGroupForRow — queued-marker handoff', () => {
  it('runs an autoRun:false group that carries a queued marker (explicit request)', () => {
    const group = makeGroup({ id: 'g1', autoRun: false })
    const table = makeTable([group])
    const row = makeRow({ g1: queuedMarker('wf-g1') })

    expect(pickNextEligibleGroupForRow(table, row)?.id).toBe('g1')
  })

  it('does NOT run an autoRun:false group with no marker (auto-cascade respects autoRun)', () => {
    const group = makeGroup({ id: 'g1', autoRun: false })
    const table = makeTable([group])
    const row = makeRow({})

    expect(pickNextEligibleGroupForRow(table, row)).toBeNull()
  })

  it('does NOT run an autoRun:true marker whose deps are unmet (no spin)', () => {
    const group = makeGroup({ id: 'g1', autoRun: true, dependencies: { columns: ['need'] } })
    const table = makeTable([group])
    // marker present, but the dep column is empty → deps-unmet
    const row = makeRow({ g1: queuedMarker('wf-g1') }, { need: '' })

    expect(pickNextEligibleGroupForRow(table, row)).toBeNull()
  })

  it('skips excludeGroupId so the just-finished group does not self-retrigger', () => {
    const group = makeGroup({ id: 'g1', autoRun: true })
    const table = makeTable([group])
    const row = makeRow({})

    expect(pickNextEligibleGroupForRow(table, row, 'g1')).toBeNull()
  })
})

describe('buildEnqueueItems billing attribution', () => {
  const run: WorkflowGroupCellPayload = {
    tableId: 'table-1',
    tableName: 'Table',
    rowId: 'row-1',
    groupId: 'group-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
  }

  it('serializes the triggering actor and workspace payer before queueing', async () => {
    const [item] = await buildEnqueueItems([{ ...run, triggeredByUserId: 'external-actor' }])

    expect(item.payload.billingAttribution).toMatchObject({
      actorUserId: 'external-actor',
      workspaceId: 'workspace-1',
      billingEntity: { type: 'organization', id: 'org-1' },
    })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'external-actor',
      workspaceId: 'workspace-1',
    })
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
  })

  it('caps the cascade carrier and serializes each workflow attempt budget', async () => {
    const [item] = await buildEnqueueItems([run])

    expect(item.payload).toHaveProperty('executionTimeoutMs')
    expect(item.options.maxDurationSeconds).toBe(5_700)
    expect(item.options.metadata?.correlation).toEqual({
      executionId: 'execution-1',
      requestId: 'wfgrp-execution-1',
      source: 'workflow_group',
      workflowId: 'workflow-1',
      triggerType: 'table',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
  })
})

describe('cancelCellRunsByTags', () => {
  it('bounds Trigger.dev cancellation concurrency and limits the retained scan window', async () => {
    mockRunsList.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 25; index++) yield { id: `run-${index}` }
      },
    })
    let activeCancellations = 0
    let maxActiveCancellations = 0
    mockRunsCancel.mockImplementation(async () => {
      activeCancellations++
      maxActiveCancellations = Math.max(maxActiveCancellations, activeCancellations)
      await Promise.resolve()
      activeCancellations--
    })

    await cancelCellRunsByTags(['tableId:table-1'])

    expect(mockRunsCancel).toHaveBeenCalledTimes(25)
    expect(maxActiveCancellations).toBeLessThanOrEqual(10)
    expect(mockRunsList).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: ['tableId:table-1'],
        limit: 100,
        from: expect.any(Date),
      })
    )
  })
})

describe('cancelWorkflowGroupRuns deletion races', () => {
  const group = makeGroup({ id: 'g1' })
  const table = makeTable([group])
  const inFlightExecution = {
    tableId: table.id,
    rowId: 'row1',
    groupId: group.id,
    status: 'running',
    executionId: 'execution-1',
    jobId: null,
    workflowId: group.workflowId,
    error: null,
    runningBlockIds: [],
    blockErrors: {},
    cancelledAt: null,
  }

  beforeEach(() => {
    setEnvFlags({ isTriggerDevEnabled: false, isBillingEnabled: true })
    mockGetTableById.mockResolvedValue(table)
  })

  it('ignores a row deleted after its in-flight execution was selected', async () => {
    queueTableRows(schemaMock.tableRowExecutions, [inFlightExecution])
    mockUpdateRow.mockRejectedValueOnce(new TableRowNotFoundError())

    await expect(cancelWorkflowGroupRuns(table.id)).resolves.toBe(1)
    expect(mockUpdateRow).toHaveBeenCalledOnce()
  })

  it('rethrows unrelated cancellation write failures', async () => {
    const error = new Error('database unavailable')
    queueTableRows(schemaMock.tableRowExecutions, [inFlightExecution])
    mockUpdateRow.mockRejectedValueOnce(error)

    await expect(cancelWorkflowGroupRuns(table.id)).rejects.toBe(error)
  })

  it('ignores a tombstone foreign-key failure caused by a deleted row', async () => {
    mockListActiveDispatches.mockResolvedValueOnce([
      { id: 'dispatch-1', scope: { groupIds: [group.id], rowIds: ['row1'] } },
    ])
    const cause = Object.assign(new Error('foreign key violation'), {
      code: '23503',
      constraint_name: 'table_row_executions_row_id_user_table_rows_id_fk',
    })
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(new Error('Failed query', { cause }))

    await expect(cancelWorkflowGroupRuns(table.id, 'row1')).resolves.toBe(0)
  })
})

/**
 * Groups run the deployed version, and a group that never said which mode it
 * wanted is a deployed-mode group. A dispatch against an undeployed workflow
 * used to be accepted and then wrote an error into every cell; the dispatcher
 * now refuses it before anything is enqueued, naming the workflow.
 */
describe('assertWorkflowGroupsDeployable', () => {
  const deployedGroup = makeGroup({ id: 'g-deployed', workflowId: 'wf-1' })
  const liveGroup = makeGroup({ id: 'g-live', workflowId: 'wf-2', deploymentMode: 'live' })

  it('refuses a manual run of a mode-less group whose workflow has no active deployment', async () => {
    queueTableRows(schemaMock.workflow, [
      { workflowId: 'wf-1', workflowName: 'Enrich leads', deploymentId: null },
    ])

    await expect(
      assertWorkflowGroupsDeployable([deployedGroup], { isManualRun: true, requestId: 'req-1' })
    ).rejects.toThrow(
      'Workflow group "g-deployed" runs the deployed version of workflow "Enrich leads" (wf-1), which has no active deployment'
    )
  })

  it('drops an undeployed group from an auto-fire instead of failing the row write', async () => {
    queueTableRows(schemaMock.workflow, [
      { workflowId: 'wf-1', workflowName: 'Enrich leads', deploymentId: null },
    ])

    await expect(
      assertWorkflowGroupsDeployable([deployedGroup, liveGroup], {
        isManualRun: false,
        requestId: 'req-1',
      })
    ).resolves.toEqual([liveGroup])
  })
})

describe('runWorkflowColumn deployment gate', () => {
  const table = {
    id: 'table-1',
    workspaceId: 'workspace-1',
    schema: {
      columns: [],
      workflowGroups: [makeGroup({ id: 'g-deployed', workflowId: 'wf-1', name: 'Scoring' })],
    },
  } as unknown as TableDefinition

  beforeEach(() => {
    mockGetTableById.mockResolvedValue(table)
  })

  it('refuses the dispatch when the group workflow was undeployed', async () => {
    queueTableRows(schemaMock.workflow, [
      { workflowId: 'wf-1', workflowName: 'Score', deploymentId: null },
    ])

    await expect(
      runWorkflowColumn({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        mode: 'all',
        groupIds: ['g-deployed'],
        requestId: 'req-1',
      })
    ).rejects.toThrow(
      'Workflow group "Scoring" runs the deployed version of workflow "Score" (wf-1), which has no active deployment'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('skips an auto-fire whose only group is undeployed without enqueueing anything', async () => {
    queueTableRows(schemaMock.workflow, [
      { workflowId: 'wf-1', workflowName: 'Score', deploymentId: null },
    ])

    await expect(
      runWorkflowColumn({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        mode: 'new',
        isManualRun: false,
        rowIds: ['row-1'],
        requestId: 'req-1',
      })
    ).resolves.toEqual({ dispatchId: null, shouldSignalRowsChanged: false })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})
