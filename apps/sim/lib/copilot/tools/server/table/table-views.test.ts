/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const useCases = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/table/application/views', () => ({
  listTableViewsUseCase: { operation: { id: 'tables.views.list' }, execute: useCases.list },
  readTableViewUseCase: { operation: { id: 'tables.views.read' }, execute: useCases.read },
  createTableViewUseCase: { operation: { id: 'tables.views.create' }, execute: useCases.create },
  updateTableViewUseCase: { operation: { id: 'tables.views.update' }, execute: useCases.update },
  deleteTableViewUseCase: { operation: { id: 'tables.views.delete' }, execute: useCases.del },
}))

const executeUseCase = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copilot/application/execute-table-use-case', () => ({
  executeCopilotTableUseCase: executeUseCase,
}))

import { tableViewsServerTool } from '@/lib/copilot/tools/server/table/table-views'

const context = { userId: 'user-1', workspaceId: 'ws-1', copilotToolExecution: true } as never

const columns = [
  { id: 'col_a', name: 'status', type: 'string' },
  { id: 'col_b', name: 'due', type: 'date' },
]
const table = { id: 'tbl-1', schema: { columns } }

describe('table_views adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('translates stored id-domain configs to column names on list', async () => {
    executeUseCase.mockResolvedValueOnce({
      table,
      views: [
        {
          id: 'view-1',
          name: 'Overdue',
          isDefault: true,
          config: {
            filter: { all: [{ field: 'col_a', op: 'ne', value: 'Done' }] },
            sort: [{ field: 'col_b', direction: 'asc' }],
          },
        },
      ],
    })

    const result = await tableViewsServerTool.execute(
      { operation: 'list_views', args: { tableId: 'tbl-1' } },
      context
    )

    expect(result.success).toBe(true)
    expect(result.data.views[0].filter).toEqual({
      all: [{ field: 'status', op: 'ne', value: 'Done' }],
    })
    expect(result.data.views[0].sort).toEqual([{ field: 'due', direction: 'asc' }])
  })

  it('translates agent column names to stable ids on create', async () => {
    executeUseCase.mockResolvedValueOnce({ table, views: [] }).mockResolvedValueOnce({
      view: { id: 'view-2', name: 'Mine', isDefault: false, config: {} },
      table,
    })

    const result = await tableViewsServerTool.execute(
      {
        operation: 'create_view',
        args: {
          tableId: 'tbl-1',
          name: 'Mine',
          filter: { all: [{ field: 'status', op: 'eq', value: 'Open' }] },
        },
      },
      context
    )

    expect(result.success).toBe(true)
    const createInput = executeUseCase.mock.calls[1][2]
    expect(createInput.config.filter).toEqual({
      all: [{ field: 'col_a', op: 'eq', value: 'Open' }],
    })
  })

  it('rejects unknown column names with the columns spelled out', async () => {
    executeUseCase.mockResolvedValueOnce({ table, views: [] })

    await expect(
      tableViewsServerTool.execute(
        {
          operation: 'create_view',
          args: {
            tableId: 'tbl-1',
            name: 'Broken',
            filter: { all: [{ field: 'nope', op: 'eq', value: 1 }] },
          },
        },
        context
      )
    ).rejects.toThrow(/Unknown column/)
  })

  it('rejects unsupported operations without invoking anything', async () => {
    const result = await tableViewsServerTool.execute(
      { operation: 'insert_row', args: { tableId: 'tbl-1' } },
      context
    )
    expect(result.success).toBe(false)
    expect(result.message).toContain('insert_row')
    expect(executeUseCase).not.toHaveBeenCalled()
  })
})
