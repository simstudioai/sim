/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const useCases = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/table/application/views', () => ({
  listTableViewsUseCase: { operation: { id: 'tables.views.list' }, execute: useCases.list },
  createTableViewUseCase: { operation: { id: 'tables.views.create' }, execute: useCases.create },
}))

const executeUseCase = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copilot/application/execute-table-use-case', () => ({
  executeCopilotTableUseCase: executeUseCase,
}))

import { createTableViewServerTool } from '@/lib/copilot/tools/server/table/create-table-view'
import { createTableViewUseCase, listTableViewsUseCase } from '@/lib/table/application/views'

const context = { userId: 'user-1', workspaceId: 'ws-1', copilotToolExecution: true } as never

const columns = [
  { id: 'col_a', name: 'status', type: 'string' },
  { id: 'col_b', name: 'due', type: 'date' },
]
const table = { id: 'tbl-1', name: 'Invoices', schema: { columns } }

describe('create_table_view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a name-translated view in one call and names the table for the panel', async () => {
    executeUseCase
      .mockResolvedValueOnce({ table, views: [{ id: 'view-0' }] })
      .mockResolvedValueOnce({
        table,
        view: {
          id: 'view-1',
          name: 'Overdue',
          isDefault: false,
          config: {
            filter: { all: [{ field: 'col_a', op: 'ne', value: 'Done' }] },
            sort: [{ field: 'col_b', direction: 'asc' }],
          },
        },
      })

    const result = await createTableViewServerTool.execute(
      {
        tableId: 'tbl-1',
        name: 'Overdue',
        config: {
          filter: { all: [{ field: 'status', op: 'ne', value: 'Done' }] },
          sort: [{ field: 'due', direction: 'asc' }],
        },
      },
      context
    )

    expect(executeUseCase).toHaveBeenNthCalledWith(
      1,
      context,
      listTableViewsUseCase,
      { tableId: 'tbl-1', workspaceId: 'ws-1' },
      { tableId: 'tbl-1' }
    )
    expect(executeUseCase).toHaveBeenNthCalledWith(
      2,
      context,
      createTableViewUseCase,
      {
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        name: 'Overdue',
        config: {
          filter: { all: [{ field: 'col_a', op: 'ne', value: 'Done' }] },
          sort: [{ field: 'col_b', direction: 'asc' }],
        },
        isDefault: undefined,
      },
      { tableId: 'tbl-1' }
    )
    expect(result.success).toBe(true)
    expect(result.message).toContain('view-1')
    expect(result.data).toEqual({
      viewId: 'view-1',
      tableId: 'tbl-1',
      tableName: 'Invoices',
      view: {
        id: 'view-1',
        name: 'Overdue',
        isDefault: false,
        filter: { all: [{ field: 'status', op: 'ne', value: 'Done' }] },
        sort: [{ field: 'due', direction: 'asc' }],
        hiddenColumns: undefined,
      },
    })
  })

  it('numbers an unnamed view after the ones the table already has and passes isDefault through', async () => {
    executeUseCase
      .mockResolvedValueOnce({ table, views: [{ id: 'view-0' }, { id: 'view-1' }] })
      .mockResolvedValueOnce({
        table,
        view: { id: 'view-2', name: 'View 3', isDefault: true, config: {} },
      })

    const result = await createTableViewServerTool.execute(
      { tableId: 'tbl-1', isDefault: true },
      context
    )

    expect(executeUseCase).toHaveBeenNthCalledWith(
      2,
      context,
      createTableViewUseCase,
      { tableId: 'tbl-1', workspaceId: 'ws-1', name: 'View 3', config: {}, isDefault: true },
      { tableId: 'tbl-1' }
    )
    expect(result.success).toBe(true)
    expect(result.message).toContain('as its default')
    expect(result.data?.view.isDefault).toBe(true)
  })

  it('refuses without a table id and without workspace context', async () => {
    expect(await createTableViewServerTool.execute({ tableId: '  ' }, context)).toEqual({
      success: false,
      message: 'tableId is required',
    })
    expect(
      await createTableViewServerTool.execute({ tableId: 'tbl-1' }, { userId: 'user-1' } as never)
    ).toEqual({ success: false, message: 'Workspace ID is required' })
    expect(executeUseCase).not.toHaveBeenCalled()
  })
})
