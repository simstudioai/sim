/**
 * @vitest-environment node
 */

import { createTableDefinition } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const mocks = vi.hoisted(() => ({
  createRows: vi.fn(),
  queryRows: vi.fn(),
  updateRow: vi.fn(),
}))

vi.mock('@/lib/table/application/rows', () => ({
  createTableRows: { execute: mocks.createRows },
  deleteTableRow: { execute: vi.fn() },
  deleteTableRows: { execute: vi.fn() },
  queryTableRows: { execute: mocks.queryRows },
  readTableRow: { execute: vi.fn() },
  updateTableRow: { execute: mocks.updateRow },
  updateTableRows: { execute: vi.fn() },
  upsertTableRow: { execute: vi.fn() },
}))

vi.mock('@/lib/table/application/tables', () => ({
  createTableUseCase: { execute: vi.fn() },
  listTableDefinitionsUseCase: { execute: vi.fn() },
  readTableDetailsUseCase: { execute: vi.fn() },
}))

import {
  executeTableInsertRows,
  executeTableQueryRows,
  executeTableUpdateRow,
  type TableToolOperationContext,
} from '@/lib/internal/table/operations'

const PRINCIPAL = createTestRuntimePrincipal()

const TABLE = createTableDefinition({
  id: 'table-1',
  workspaceId: 'workspace-canonical',
  columns: [{ id: 'column-1', name: 'Email', type: 'string' }],
})

const ROW = {
  id: 'row-1',
  data: { 'column-1': 'a@example.com' },
  position: 0,
  orderKey: 'a0',
  createdAt: new Date('2026-08-27T00:00:00.000Z'),
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
}

function operationContext(): TableToolOperationContext {
  return {
    principal: PRINCIPAL,
    workspaceId: 'workspace-canonical',
    headers: new Headers(),
    requestId: 'request-1',
  }
}

describe('Table direct operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createRows.mockResolvedValue({ kind: 'single', table: TABLE, row: ROW })
    mocks.updateRow.mockResolvedValue({ table: TABLE, row: ROW, changed: true })
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: 1,
      limit: 10,
      offset: 0,
      nextCursor: null,
    })
  })

  it('uses canonical principal workspace instead of the prepared body assertion', async () => {
    await executeTableUpdateRow(
      'table-1',
      'row-1',
      { workspaceId: 'workspace-forged', data: { Email: 'a@example.com' } },
      operationContext()
    )

    expect(mocks.updateRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        tableId: 'table-1',
        rowId: 'row-1',
        assertedWorkspaceId: 'workspace-canonical',
        dataKeying: 'names',
        strictWrite: false,
        secretProvenanceEnvelope: { kind: 'none' },
      }),
    })
  })

  it('hands unresolved write provenance to the authorized create use case', async () => {
    await executeTableInsertRows(
      'table-1',
      { workspaceId: 'workspace-forged', data: { Email: 'a@example.com' } },
      operationContext()
    )

    expect(mocks.createRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        assertedWorkspaceId: 'workspace-canonical',
        dataKeying: 'names',
        secretProvenanceEnvelope: { kind: 'none' },
      }),
    })
  })

  it('preserves legacy name-keyed filter, sort, count, and offset query semantics', async () => {
    await executeTableQueryRows(
      'table-1',
      {
        workspaceId: 'workspace-forged',
        filter: { Email: { $eq: 'a@example.com' } },
        sort: { Email: 'asc' },
        limit: 10,
        offset: 4,
        includeTotal: true,
      },
      operationContext()
    )

    expect(mocks.queryRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        assertedWorkspaceId: 'workspace-canonical',
        legacyFilter: { Email: { $eq: 'a@example.com' } },
        legacySort: { Email: 'asc' },
        legacyKeying: 'names',
        limit: 10,
        offset: 4,
        includeTotal: true,
        includeRunState: true,
        allowExpandedLimit: true,
      }),
    })
  })
})
