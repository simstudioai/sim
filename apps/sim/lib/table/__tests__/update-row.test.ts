/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateRow } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'

vi.mock('@sim/db', () => dbChainMock)

const EXISTING_ROW = {
  id: 'row-1',
  tableId: 'tbl-1',
  workspaceId: 'ws-1',
  data: { name: 'Alice', age: 30 },
  position: 1,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const TABLE: TableDefinition = {
  id: 'tbl-1',
  name: 'People',
  description: null,
  schema: {
    columns: [
      { name: 'name', type: 'string' },
      { name: 'age', type: 'number' },
    ],
  },
  metadata: null,
  rowCount: 0,
  maxRows: 1000,
  workspaceId: 'ws-1',
  createdBy: 'user-1',
  archivedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('updateRow — partial merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([EXISTING_ROW])
  })

  it('preserves columns not included in the partial update', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: 31 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Alice', age: 31 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Alice', age: 31 } })
    )
  })

  it('allows updating a single column without affecting others', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Bob' }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Bob', age: 30 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Bob', age: 30 } })
    )
  })

  it('allows explicitly nulling a field while preserving others', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: null }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Alice', age: null })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Alice', age: null } })
    )
  })

  it('handles a full-row update correctly (idempotent merge)', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Bob', age: 25 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Bob', age: 25 })
  })

  it('throws when the row does not exist', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      updateRow(
        { tableId: 'tbl-1', rowId: 'row-missing', data: { age: 31 }, workspaceId: 'ws-1' },
        TABLE,
        'req-1'
      )
    ).rejects.toThrow('Row not found')
  })
})
