/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockGetTableById, mockReplaceTableRows } = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockReplaceTableRows: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
}))

vi.mock('@/lib/table/rows/service', () => ({
  replaceTableRows: mockReplaceTableRows,
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotSpan: (
    _name: string,
    _attrs: Record<string, unknown> | undefined,
    fn: (span: unknown) => Promise<unknown>
  ) => fn({ setAttribute: vi.fn(), setAttributes: vi.fn(), addEvent: vi.fn() }),
}))

import { FunctionExecute, Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  maybeWriteOutputToTable,
  maybeWriteReadCsvToTable,
} from '@/lib/copilot/request/tools/tables'
import type { ExecutionContext } from '@/lib/copilot/request/types'

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { id: 'col_name', name: 'name', type: 'string' },
        { id: 'col_age', name: 'age', type: 'number' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  } as TableDefinition
}

function buildContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    userId: 'user-1',
    workflowId: 'wf-1',
    workspaceId: 'workspace-1',
    userPermission: 'write',
    ...overrides,
  }
}

describe('maybeWriteOutputToTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable())
    mockReplaceTableRows.mockResolvedValue({ deletedCount: 0, insertedCount: 2 })
  })

  it('rejects a table from another workspace without touching it', async () => {
    mockGetTableById.mockResolvedValue(buildTable({ workspaceId: 'other-workspace' }))

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }] } },
      buildContext()
    )

    expect(result).toEqual({ success: false, error: 'Table "tbl_1" not found' })
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('denies a read-only principal without touching the table', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }] } },
      buildContext({ userPermission: 'read' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires write access')
    expect(mockGetTableById).not.toHaveBeenCalled()
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('replaces rows through the service with name keys remapped to column ids', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      {
        success: true,
        output: {
          result: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 40 },
          ],
        },
      },
      buildContext()
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledTimes(1)
    const [data, table] = mockReplaceTableRows.mock.calls[0]
    expect(data).toMatchObject({
      tableId: 'tbl_1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      rows: [
        { col_name: 'Alice', col_age: 30 },
        { col_name: 'Bob', col_age: 40 },
      ],
    })
    expect(table.id).toBe('tbl_1')
  })

  it('fails fast when no row keys match the table columns', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ wrong: 1 }, { keys: 2 }] } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 1 has no keys matching columns')
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('fails fast when only some rows match instead of writing empty rows', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }, { wrong: 'x' }] } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 2 has no keys matching columns')
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('surfaces service validation failures as tool errors', async () => {
    mockReplaceTableRows.mockRejectedValue(new Error('Row 1: name is required'))

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ age: 30 }] } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 1: name is required')
  })
})

describe('maybeWriteReadCsvToTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable())
    mockReplaceTableRows.mockResolvedValue({ deletedCount: 0, insertedCount: 2 })
  })

  it('rejects a table from another workspace without touching it', async () => {
    mockGetTableById.mockResolvedValue(buildTable({ workspaceId: 'other-workspace' }))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAlice,30' } },
      buildContext()
    )

    expect(result).toEqual({ success: false, error: 'Table "tbl_1" not found' })
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('denies a read-only principal without touching the table', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAlice,30' } },
      buildContext({ userPermission: 'read' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires write access')
    expect(mockGetTableById).not.toHaveBeenCalled()
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('imports CSV content through the service with id-keyed rows', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAlice,30\nBob,40' } },
      buildContext()
    )

    expect(result.success).toBe(true)
    const [data] = mockReplaceTableRows.mock.calls[0]
    expect(data.rows).toEqual([
      { col_name: 'Alice', col_age: '30' },
      { col_name: 'Bob', col_age: '40' },
    ])
  })

  it('fails fast when the file headers match no table columns', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'wrong,headers\n1,2' } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 1 has no keys matching columns')
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('surfaces service validation failures as tool errors', async () => {
    mockReplaceTableRows.mockRejectedValue(new Error('Row 1: name is required'))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'age\n30' } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 1: name is required')
  })
})
