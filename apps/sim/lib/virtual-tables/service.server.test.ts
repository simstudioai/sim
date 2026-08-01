/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeCursor } from '@/lib/table/rows/cursor'
import type { TableDefinition, TableRow } from '@/lib/table/types'

const {
  mockFindMemoryRowMatches,
  mockGetMemoryById,
  mockGetMemoryDefinition,
  mockQueryMemoryRows,
} = vi.hoisted(() => ({
  mockFindMemoryRowMatches: vi.fn(),
  mockGetMemoryById: vi.fn(),
  mockGetMemoryDefinition: vi.fn(),
  mockQueryMemoryRows: vi.fn(),
}))

vi.mock('@/lib/virtual-tables/memory-virtual-table.server', () => ({
  findMemoryTableRowMatches: mockFindMemoryRowMatches,
  getMemoryTableById: mockGetMemoryById,
  getMemoryTableDefinition: mockGetMemoryDefinition,
  queryMemoryTableRows: mockQueryMemoryRows,
}))

import {
  findVirtualTableRowMatches,
  getVirtualTableById,
  listVirtualTables,
  queryVirtualTableRows,
} from '@/lib/virtual-tables/service.server'

const MEMORY_TABLE: TableDefinition = {
  id: 'system_memory_workspace-1',
  name: 'Memory',
  schema: { columns: [] },
  rowCount: 0,
  maxRows: Number.MAX_SAFE_INTEGER,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  locks: { schemaLocked: true, insertLocked: true, updateLocked: true, deleteLocked: true },
  isVirtual: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function createRow(id: string, orderKey: string, data: TableRow['data'] = {}): TableRow {
  const timestamp = new Date(orderKey)
  return {
    id,
    data,
    executions: {},
    position: 0,
    orderKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('virtual table service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists virtual definitions for active and all scopes', async () => {
    const memoryTable = { id: 'system_memory_workspace-1' }
    mockGetMemoryDefinition.mockResolvedValue(memoryTable)

    await expect(listVirtualTables('workspace-1', { scope: 'active' })).resolves.toEqual([
      memoryTable,
    ])
    await expect(listVirtualTables('workspace-1', { scope: 'all' })).resolves.toEqual([memoryTable])
    await expect(listVirtualTables('workspace-1', { scope: 'archived' })).resolves.toEqual([])
  })

  it('paginates candidate rows returned by a virtual table', async () => {
    const firstRow = createRow('memory-1', '2026-01-02T00:00:00.000Z')
    const witnessRow = createRow('memory-2', '2026-01-01T00:00:00.000Z')
    mockQueryMemoryRows.mockResolvedValue({
      rows: [firstRow, witnessRow],
      totalCount: 2,
      keysetValid: true,
    })

    const result = await queryVirtualTableRows(MEMORY_TABLE, {
      limit: 1,
      offset: 0,
      includeTotal: true,
    })

    expect(result).toMatchObject({
      rows: [firstRow],
      rowCount: 1,
      totalCount: 2,
      limit: 1,
      offset: 0,
    })
    expect(decodeCursor(result.nextCursor as string)).toEqual({
      after: { orderKey: firstRow.orderKey, id: firstRow.id },
    })
    expect(mockQueryMemoryRows).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      limit: 2,
      offset: 0,
      includeTotal: true,
    })
  })

  it('returns an empty completed page from a virtual table', async () => {
    mockQueryMemoryRows.mockResolvedValue({ rows: [], totalCount: null, keysetValid: true })

    await expect(
      queryVirtualTableRows(MEMORY_TABLE, {
        limit: 100,
        offset: 0,
        includeTotal: false,
      })
    ).resolves.toEqual({
      rows: [],
      rowCount: 0,
      totalCount: null,
      limit: 100,
      offset: 0,
      nextCursor: null,
    })
    expect(mockQueryMemoryRows).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      limit: 101,
      offset: 0,
      includeTotal: false,
    })
  })

  it('emits a continuation cursor when the provider byte-cuts a short page', async () => {
    const firstRow = createRow('memory-1', '2026-01-02T00:00:00.000Z')
    mockQueryMemoryRows.mockResolvedValue({
      rows: [firstRow],
      totalCount: 2,
      keysetValid: true,
      hasMore: true,
    })

    const result = await queryVirtualTableRows(MEMORY_TABLE, {
      limit: 1000,
      offset: 0,
      includeTotal: true,
    })

    expect(decodeCursor(result.nextCursor as string)).toEqual({
      after: { orderKey: firstRow.orderKey, id: firstRow.id },
    })
  })

  it('emits a sort-bound offset cursor when a provider cannot use a keyset', async () => {
    const firstRow = createRow('memory-1', '2026-01-02T00:00:00.000Z')
    const witnessRow = createRow('memory-2', '2026-01-01T00:00:00.000Z')
    mockQueryMemoryRows.mockResolvedValue({
      rows: [firstRow, witnessRow],
      totalCount: null,
      keysetValid: false,
    })

    const result = await queryVirtualTableRows(MEMORY_TABLE, {
      limit: 1,
      offset: 5,
      sort: { message_count: 'asc' },
      includeTotal: false,
    })

    expect(decodeCursor(result.nextCursor as string)).toEqual({
      offset: 6,
      sortKey: JSON.stringify([['message_count', 'asc']]),
    })
  })

  it('delegates find to the virtual table storage implementation', async () => {
    const result = {
      matches: [{ ordinal: 100, rowId: 'memory-target', column: 'transcript' }],
      truncated: false,
    }
    mockFindMemoryRowMatches.mockResolvedValueOnce(result)

    await expect(
      findVirtualTableRowMatches(MEMORY_TABLE, {
        q: 'needle',
        filter: { conversation_id: { $contains: 'customer' } },
        sort: { updated_at: 'asc' },
      })
    ).resolves.toBe(result)

    expect(mockFindMemoryRowMatches).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      q: 'needle',
      filter: { conversation_id: { $contains: 'customer' } },
      sort: { updated_at: 'asc' },
    })
    expect(mockQueryMemoryRows).not.toHaveBeenCalled()
  })

  it('rejects a definition not registered as a virtual table', async () => {
    await expect(
      queryVirtualTableRows({ ...MEMORY_TABLE, id: 'system_unknown_workspace-1' }, { limit: 100 })
    ).rejects.toThrow('Virtual table not found')
    expect(mockQueryMemoryRows).not.toHaveBeenCalled()
  })

  it('gets a virtual definition containing its real workspace ID', async () => {
    const memoryTable = { id: 'system_memory_workspace-1' }
    mockGetMemoryById.mockResolvedValueOnce(memoryTable)

    await expect(getVirtualTableById('system_memory_workspace-1')).resolves.toBe(memoryTable)
    await expect(getVirtualTableById('table-1')).resolves.toBeNull()
    expect(mockGetMemoryById).toHaveBeenCalledOnce()
    expect(mockGetMemoryById).toHaveBeenCalledWith('system_memory_workspace-1')
  })
})
