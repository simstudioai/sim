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
} = vi.hoisted(() => ({
  mockCancelRuns: vi.fn(),
  mockGetRowById: vi.fn(),
  mockResolveContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockRequireTableRowIds: vi.fn(),
  mockRunWorkflowColumn: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
  mockTranslatePredicate: vi.fn(),
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
  requireTableRowIds: mockRequireTableRowIds,
  TABLE_LIMITS: { MAX_COLUMNS_PER_TABLE: 2 },
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mockResolveContext,
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

import { cancelTableRuns, startTableRun } from '@/lib/table/application/runs'

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
    })
    expect(result.dispatchId).toBe('dispatch-1')
    expect(mockSignalRowsChanged).toHaveBeenCalledWith(TABLE.id)
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
