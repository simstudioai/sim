/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const {
  mockCancelRuns,
  mockGetRowById,
  mockResolveContext,
  mockResolvePermission,
  mockRequireTableRowIds,
  mockRunWorkflowColumn,
  mockSignalRowsChanged,
  mockTranslatePredicate,
  mockGetTableById,
  mockReadDispatch,
  mockListActiveDispatches,
  mockCancelDispatchById,
  mockResolveWorkspaceContext,
} = vi.hoisted(() => ({
  mockCancelRuns: vi.fn(),
  mockGetRowById: vi.fn(),
  mockResolveContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockRequireTableRowIds: vi.fn(),
  mockRunWorkflowColumn: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
  mockTranslatePredicate: vi.fn(),
  mockGetTableById: vi.fn(),
  mockReadDispatch: vi.fn(),
  mockListActiveDispatches: vi.fn(),
  mockCancelDispatchById: vi.fn(),
  mockResolveWorkspaceContext: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mockResolvePermission,
}))

vi.mock('@/lib/table', () => ({
  DEFAULT_TABLE_PLAN_LIMITS: { enterprise: { maxRowsPerTable: 2 } },
  getRowById: mockGetRowById,
  getTableById: mockGetTableById,
  requireTableRowIds: mockRequireTableRowIds,
  TABLE_LIMITS: { MAX_COLUMNS_PER_TABLE: 2 },
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mockResolveContext,
  resolveTableWorkspaceContext: mockResolveWorkspaceContext,
}))

vi.mock('@/lib/table/dispatcher', () => ({
  cancelDispatchById: mockCancelDispatchById,
  listActiveDispatches: mockListActiveDispatches,
  readDispatch: mockReadDispatch,
}))

vi.mock('@/lib/table/application/rows', () => ({
  tablePredicateNamesToFilter: mockTranslatePredicate,
}))

vi.mock('@/lib/table/events', () => ({
  signalTableRowsChanged: mockSignalRowsChanged,
}))

vi.mock('@/lib/table/workflow-columns', () => ({
  cancelWorkflowGroupRuns: mockCancelRuns,
  runWorkflowColumn: mockRunWorkflowColumn,
}))

import {
  cancelTableDispatch,
  cancelTableRuns,
  listTableDispatches,
  readTableDispatch,
  startTableRun,
} from '@/lib/table/application/runs'

const TABLE: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: {
    columns: [],
    workflowGroups: [
      {
        id: 'group-1',
        name: 'Enrich',
        type: 'enrichment',
        enrichmentId: 'enrichment-1',
        workflowId: '',
        targetColumnIds: [],
        sourceColumnIds: [],
      },
    ],
  },
  metadata: null,
  rowCount: 1,
  maxRows: 10,
  workspaceId: 'workspace-canonical',
  createdBy: 'owner-1',
  archivedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const PRINCIPAL = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

describe('table run application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue({
      tableId: TABLE.id,
      table: TABLE,
      workspaceId: TABLE.workspaceId,
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mockGetRowById.mockResolvedValue({ id: 'row-1' })
    mockRunWorkflowColumn.mockResolvedValue({
      dispatchId: 'dispatch-1',
      shouldSignalRowsChanged: true,
    })
    mockRequireTableRowIds.mockResolvedValue(undefined)
    mockCancelRuns.mockResolvedValue(1)
    mockTranslatePredicate.mockReturnValue({ all: [] })
  })

  it('canonically validates row and group before enrichment dispatch', async () => {
    const result = await startTableRun.execute({
      principal: PRINCIPAL,
      input: {
        kind: 'row_enrichment',
        tableId: TABLE.id,
        assertedWorkspaceId: TABLE.workspaceId,
        rowId: 'row-1',
        groupId: 'group-1',
        requestId: 'request-1',
      },
    })

    expect(mockGetRowById).toHaveBeenCalledWith(TABLE.id, 'row-1', TABLE.workspaceId)
    expect(mockRunWorkflowColumn).toHaveBeenCalledWith({
      tableId: TABLE.id,
      workspaceId: TABLE.workspaceId,
      groupIds: ['group-1'],
      rowIds: ['row-1'],
      mode: 'all',
      requestId: 'request-1',
      triggeredByUserId: PRINCIPAL.userId,
      capabilityGovernedUserId: PRINCIPAL.userId,
    })
    expect(result.dispatchId).toBe('dispatch-1')
    expect(mockSignalRowsChanged).toHaveBeenCalledWith(TABLE.id)
  })

  /**
   * A workspace key names no human, so its run is ungoverned. The meter still
   * needs someone, and attribution answers with the workspace billed account —
   * a bystander whose tool denylist must not reach the run's cells. The two
   * subjects are carried separately precisely so this case can differ.
   */
  it('carries the billed account as the meter but nobody as the gate for a workspace key', async () => {
    await startTableRun.execute({
      principal: { kind: 'workspace_api_key', workspaceId: TABLE.workspaceId, keyId: 'key-1' },
      input: {
        kind: 'row_enrichment',
        tableId: TABLE.id,
        assertedWorkspaceId: TABLE.workspaceId,
        rowId: 'row-1',
        groupId: 'group-1',
        requestId: 'request-1',
      },
    })

    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredByUserId: 'billing-owner-1',
        capabilityGovernedUserId: null,
      })
    )
  })

  it('rejects missing canonical groups and rows without dispatching', async () => {
    await expect(
      startTableRun.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'row_enrichment',
          tableId: TABLE.id,
          rowId: 'row-1',
          groupId: 'missing-group',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    mockGetRowById.mockResolvedValueOnce(null)
    await expect(
      startTableRun.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'row_enrichment',
          tableId: TABLE.id,
          rowId: 'missing-row',
          groupId: 'group-1',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('bounds explicit row selections before dispatch', async () => {
    await expect(
      startTableRun.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'selection',
          tableId: TABLE.id,
          groupIds: ['group-1'],
          mode: 'all',
          rowIds: ['row-1', 'row-2', 'row-3'],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('deduplicates and canonically verifies explicit row selections', async () => {
    await startTableRun.execute({
      principal: PRINCIPAL,
      input: {
        kind: 'selection',
        tableId: TABLE.id,
        groupIds: ['group-1', 'group-1'],
        mode: 'all',
        rowIds: ['row-1', 'row-1'],
      },
    })

    expect(mockRequireTableRowIds).toHaveBeenCalledWith(TABLE.id, TABLE.workspaceId, ['row-1'])
    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({ groupIds: ['group-1'], rowIds: ['row-1'] })
    )
  })

  it('does not signal when the dispatcher reports a no-op', async () => {
    mockRunWorkflowColumn.mockResolvedValue({
      dispatchId: null,
      shouldSignalRowsChanged: false,
    })

    await startTableRun.execute({
      principal: PRINCIPAL,
      input: {
        kind: 'selection',
        tableId: TABLE.id,
        groupIds: ['group-1'],
        mode: 'incomplete',
      },
    })

    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })

  it('signals a cleared row state when cancellation wins before dispatch', async () => {
    mockRunWorkflowColumn.mockResolvedValue({
      dispatchId: null,
      shouldSignalRowsChanged: true,
    })

    await startTableRun.execute({
      principal: PRINCIPAL,
      input: {
        kind: 'selection',
        tableId: TABLE.id,
        groupIds: ['group-1'],
        mode: 'all',
      },
    })

    expect(mockSignalRowsChanged).toHaveBeenCalledWith(TABLE.id)
  })

  it('requires a canonical row for row cancellation', async () => {
    mockGetRowById.mockResolvedValue(null)

    await expect(
      cancelTableRuns.execute({
        principal: PRINCIPAL,
        input: { scope: 'row', tableId: TABLE.id, rowId: 'missing-row' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockCancelRuns).not.toHaveBeenCalled()
  })

  it('signals only authoritative cancellations and propagates infrastructure failures', async () => {
    mockCancelRuns.mockResolvedValueOnce(0)
    await cancelTableRuns.execute({
      principal: PRINCIPAL,
      input: { scope: 'all', tableId: TABLE.id },
    })
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()

    mockCancelRuns.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      cancelTableRuns.execute({
        principal: PRINCIPAL,
        input: { scope: 'all', tableId: TABLE.id },
      })
    ).rejects.toThrow('database unavailable')
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })
})

/**
 * The dispatch resource `POST /tables/{tableId}/dispatches` hands back an id for.
 *
 * The regression these guard is the published status set: the first-party
 * active-dispatch schema knows only `pending` and `dispatching`, so a resource
 * read built on it would turn polling a finished run — the exact thing a poller
 * is waiting for — into a 500.
 */
describe('table run dispatch reads', () => {
  const DISPATCH = {
    id: 'dispatch-1',
    tableId: TABLE.id,
    workspaceId: TABLE.workspaceId,
    requestId: 'request-1',
    mode: 'all' as const,
    scope: { groupIds: ['group-1'] },
    status: 'dispatching' as const,
    cursor: 0,
    limit: null,
    processedCount: 0,
    isManualRun: true,
    triggeredByUserId: 'user-1',
    requestedAt: new Date('2026-01-01'),
    completedAt: null,
    cancelledAt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('read')
    mockResolveWorkspaceContext.mockResolvedValue({
      workspaceId: TABLE.workspaceId,
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mockResolveContext.mockResolvedValue({
      tableId: TABLE.id,
      table: TABLE,
      workspaceId: TABLE.workspaceId,
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mockGetTableById.mockResolvedValue(TABLE)
    mockReadDispatch.mockResolvedValue(DISPATCH)
    mockListActiveDispatches.mockResolvedValue([DISPATCH])
  })

  it.each(['pending', 'dispatching', 'complete', 'cancelled'] as const)(
    'reads a %s dispatch',
    async (status) => {
      mockReadDispatch.mockResolvedValue({ ...DISPATCH, status })

      const result = await readTableDispatch.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, dispatchId: DISPATCH.id, workspaceId: TABLE.workspaceId },
      })

      expect(result.dispatch.status).toBe(status)
    }
  )

  it('conceals a dispatch in another workspace as not found', async () => {
    mockReadDispatch.mockResolvedValue({ ...DISPATCH, workspaceId: 'workspace-other' })

    await expect(
      readTableDispatch.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, dispatchId: DISPATCH.id, workspaceId: TABLE.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('conceals a dispatch whose table is gone as not found', async () => {
    mockGetTableById.mockResolvedValue(null)

    await expect(
      readTableDispatch.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, dispatchId: DISPATCH.id, workspaceId: TABLE.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reports a dispatch id that never existed as not found', async () => {
    mockReadDispatch.mockResolvedValue(null)

    await expect(
      readTableDispatch.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, dispatchId: 'nope', workspaceId: TABLE.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  /**
   * Nesting the read under its table means the parent is authorized first — and a dispatch id
   * belonging to a DIFFERENT table must not confirm its own existence through the table the
   * caller named.
   */
  it('conceals a dispatch belonging to another table as not found', async () => {
    mockReadDispatch.mockResolvedValue({ ...DISPATCH, tableId: 'table-other' })

    await expect(
      readTableDispatch.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          dispatchId: DISPATCH.id,
          workspaceId: TABLE.workspaceId,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('cancels an active dispatch by id and returns its settled state', async () => {
    mockResolvePermission.mockResolvedValue('write')
    mockReadDispatch.mockResolvedValueOnce(DISPATCH)
    mockReadDispatch.mockResolvedValueOnce({ ...DISPATCH, status: 'cancelled' })

    const result = await cancelTableDispatch.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, dispatchId: DISPATCH.id, workspaceId: TABLE.workspaceId },
    })

    expect(mockCancelDispatchById).toHaveBeenCalledWith(DISPATCH.id)
    expect(result.dispatch.status).toBe('cancelled')
  })

  it('leaves a terminal dispatch alone rather than re-cancelling it', async () => {
    mockResolvePermission.mockResolvedValue('write')
    mockReadDispatch.mockResolvedValue({ ...DISPATCH, status: 'complete' })

    const result = await cancelTableDispatch.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, dispatchId: DISPATCH.id, workspaceId: TABLE.workspaceId },
    })

    expect(mockCancelDispatchById).not.toHaveBeenCalled()
    expect(result.dispatch.status).toBe('complete')
  })

  it('conceals a cancel of a dispatch belonging to another table as not found', async () => {
    mockResolvePermission.mockResolvedValue('write')
    mockReadDispatch.mockResolvedValue({ ...DISPATCH, tableId: 'table-other' })

    await expect(
      cancelTableDispatch.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, dispatchId: DISPATCH.id, workspaceId: TABLE.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockCancelDispatchById).not.toHaveBeenCalled()
  })

  it('lists the active dispatches for the canonical table', async () => {
    const result = await listTableDispatches.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, assertedWorkspaceId: TABLE.workspaceId },
    })

    expect(mockListActiveDispatches).toHaveBeenCalledWith(TABLE.id)
    expect(result.dispatches).toEqual([DISPATCH])
  })
})
