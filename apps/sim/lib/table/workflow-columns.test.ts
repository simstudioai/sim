/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import type {
  RowExecutionMetadata,
  TableDefinition,
  TableRow,
  WorkflowGroup,
} from '@/lib/table/types'

const {
  mockResolveBillingAttribution,
  mockResolveSystemBillingAttribution,
  mockRunsCancel,
  mockRunsList,
  mockGetJobQueue,
  mockGetTableById,
  mockListActiveDispatches,
  mockMarkActiveDispatchesCancelled,
  mockQueueCancelByKey,
  mockQueueCancelJob,
  mockUpdateRow,
} = vi.hoisted(() => ({
  mockResolveBillingAttribution: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockRunsCancel: vi.fn(),
  mockRunsList: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockGetTableById: vi.fn(),
  mockListActiveDispatches: vi.fn(),
  mockMarkActiveDispatchesCancelled: vi.fn(),
  mockQueueCancelByKey: vi.fn(),
  mockQueueCancelJob: vi.fn(),
  mockUpdateRow: vi.fn(),
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

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: vi.fn((value) => value),
  resolveBillingAttribution: mockResolveBillingAttribution,
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
}))

vi.mock('@trigger.dev/sdk', () => ({
  runs: {
    cancel: mockRunsCancel,
    list: mockRunsList,
  },
}))

vi.mock('@/lib/core/async-jobs/config', () => ({
  getJobQueue: mockGetJobQueue,
}))

vi.mock('@/lib/table/dispatcher', () => ({
  listActiveDispatches: mockListActiveDispatches,
  markActiveDispatchesCancelled: mockMarkActiveDispatchesCancelled,
}))

vi.mock('@/lib/table/rows/service', () => ({
  updateRow: mockUpdateRow,
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
}))

import {
  assertWorkflowGroupsDeployable,
  buildEnqueueItems,
  cancelCellRunsByTags,
  cancelWorkflowGroupRuns,
  pickNextEligibleGroupForRow,
  runWorkflowColumn,
  type WorkflowGroupCellPayload,
} from '@/lib/table/workflow-columns'

beforeEach(() => {
  vi.clearAllMocks()
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

  it('still runs a normal autoRun:true group whose deps are satisfied (no marker)', () => {
    const group = makeGroup({ id: 'g1', autoRun: true })
    const table = makeTable([group])
    const row = makeRow({})

    expect(pickNextEligibleGroupForRow(table, row)?.id).toBe('g1')
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

  it('uses one atomic system actor and payer snapshot for headless runs', async () => {
    const [item] = await buildEnqueueItems([run])

    expect(item.payload.billingAttribution).toMatchObject({
      actorUserId: 'owner-after-transfer',
      billedAccountUserId: 'owner-after-transfer',
      billingEntity: { type: 'organization', id: 'org-after-transfer' },
    })
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('workspace-1')
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
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

  it('preserves an existing immutable attribution snapshot without re-resolving', async () => {
    const billingAttribution = {
      actorUserId: 'external-actor',
      workspaceId: 'workspace-1',
      organizationId: 'org-original',
      billedAccountUserId: 'owner-original',
      billingEntity: { type: 'organization' as const, id: 'org-original' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }

    const [item] = await buildEnqueueItems([{ ...run, billingAttribution }])

    expect(item.payload.billingAttribution).toEqual(billingAttribution)
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
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

  it('ignores a transaction-wrapped row deletion', async () => {
    queueTableRows(schemaMock.tableRowExecutions, [inFlightExecution])
    mockUpdateRow.mockRejectedValueOnce(
      new Error('Failed query', { cause: new TableRowNotFoundError() })
    )

    await expect(cancelWorkflowGroupRuns(table.id)).resolves.toBe(1)
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

  it('rethrows tombstone failures from any other constraint', async () => {
    mockListActiveDispatches.mockResolvedValueOnce([
      { id: 'dispatch-1', scope: { groupIds: [group.id], rowIds: ['row1'] } },
    ])
    const cause = Object.assign(new Error('foreign key violation'), {
      code: '23503',
      constraint_name: 'table_row_executions_table_id_user_table_definitions_id_fk',
    })
    const error = new Error('Failed query', { cause })
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(error)

    await expect(cancelWorkflowGroupRuns(table.id, 'row1')).rejects.toBe(error)
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
  const enrichmentGroup = makeGroup({
    id: 'g-enrich',
    workflowId: '',
    type: 'enrichment',
    enrichmentId: 'company-domain',
  })

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

  it('passes a deployed-mode group whose workflow has an active deployment', async () => {
    queueTableRows(schemaMock.workflow, [
      { workflowId: 'wf-1', workflowName: 'Enrich leads', deploymentId: 'dep-1' },
    ])

    await expect(
      assertWorkflowGroupsDeployable([deployedGroup], { isManualRun: true, requestId: 'req-1' })
    ).resolves.toEqual([deployedGroup])
  })

  it('does not check live-mode or enrichment groups', async () => {
    await expect(
      assertWorkflowGroupsDeployable([liveGroup, enrichmentGroup], {
        isManualRun: true,
        requestId: 'req-1',
      })
    ).resolves.toEqual([liveGroup, enrichmentGroup])
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
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
