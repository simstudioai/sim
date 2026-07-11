/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RowExecutionMetadata,
  TableDefinition,
  TableRow,
  WorkflowGroup,
} from '@/lib/table/types'

const { mockResolveBillingAttribution, mockResolveSystemBillingAttribution } = vi.hoisted(() => ({
  mockResolveBillingAttribution: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
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

vi.mock('@/lib/core/config/env-flags', () => ({
  isTriggerDevEnabled: true,
}))

import {
  buildEnqueueItems,
  pickNextEligibleGroupForRow,
  type WorkflowGroupCellPayload,
} from '@/lib/table/workflow-columns'

beforeEach(() => {
  vi.clearAllMocks()
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
