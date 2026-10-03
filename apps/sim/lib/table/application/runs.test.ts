import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockReadDispatch, mockListDispatches, mockCancelDispatchById } = vi.hoisted(() => ({
  mockReadDispatch: vi.fn(),
  mockListDispatches: vi.fn(),
  mockCancelDispatchById: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/table', () => ({
  ...tableMock,
  DEFAULT_TABLE_PLAN_LIMITS: {
    ...tableMock.DEFAULT_TABLE_PLAN_LIMITS,
    enterprise: { ...tableMock.DEFAULT_TABLE_PLAN_LIMITS.enterprise, maxRowsPerTable: 2 },
  },
  TABLE_LIMITS: { ...tableMock.TABLE_LIMITS, MAX_COLUMNS_PER_TABLE: 2 },
}))

vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)

vi.mock('@/lib/table/dispatcher', () => ({
  cancelDispatchById: mockCancelDispatchById,
  listDispatches: mockListDispatches,
  readDispatch: mockReadDispatch,
}))

vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

vi.mock('@/lib/table/events', () => tableEventsMock)

vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

import {
  cancelTableDispatch,
  cancelTableRuns,
  readTableDispatch,
  startTableRun,
} from '@/lib/table/application/runs'

const { mockGetRowById, mockGetTableById, mockRequireTableRowIds } = tableMockFns
const {
  mockResolveActiveTableContext: mockResolveContext,
  mockResolveTableWorkspaceContext: mockResolveWorkspaceContext,
} = tableApplicationContextMockFns
const mockTranslatePredicate = tableApplicationRowsMockFns.mockTablePredicateNamesToFilter
const { mockCancelWorkflowGroupRuns: mockCancelRuns, mockRunWorkflowColumn } =
  tableWorkflowColumnsMockFns
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockSignalRowsChanged = tableEventsMockFns.mockSignalTableRowsChanged

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

const PRINCIPAL = createSessionPrincipal()

describe('table run application use cases', () => {
  beforeEach(() => {
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

  /**
   * A workspace key names no human, so its run is ungoverned. The meter still
   * needs someone, and attribution answers with the workspace billed account —
   * a bystander whose tool denylist must not reach the run's cells. The two
   * subjects are carried separately precisely so this case can differ.
   */
  it('carries the billed account as the meter but nobody as the gate for a workspace key', async () => {
    await startTableRun.execute({
      principal: createWorkspaceApiKeyPrincipal({ workspaceId: TABLE.workspaceId }),
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
    mockListDispatches.mockResolvedValue([DISPATCH])
  })

  it('conceals a dispatch in another workspace as not found', async () => {
    mockReadDispatch.mockResolvedValue({ ...DISPATCH, workspaceId: 'workspace-other' })

    await expect(
      readTableDispatch.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, dispatchId: DISPATCH.id, workspaceId: TABLE.workspaceId },
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
})
