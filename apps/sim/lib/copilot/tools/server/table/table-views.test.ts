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
import { asOrchestrationError } from '@/lib/core/orchestration/types'

const context = { userId: 'user-1', workspaceId: 'ws-1', copilotToolExecution: true } as never

const columns = [
  { id: 'col_a', name: 'status', type: 'string' },
  { id: 'col_b', name: 'due', type: 'date' },
]
const table = { id: 'tbl-1', name: 'Invoices', schema: { columns } }

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
    expect(createInput).not.toHaveProperty('isDefault')
    // What resource extraction reads to open the panel on the new view.
    expect(result.data).toMatchObject({ tableId: 'tbl-1', tableName: 'Invoices', viewId: 'view-2' })
  })

  it('makes the view default inside the same create, with no follow-up write', async () => {
    executeUseCase.mockResolvedValueOnce({ table, views: [] }).mockResolvedValueOnce({
      view: { id: 'view-2', name: 'Mine', isDefault: true, config: {} },
      table,
    })

    const result = await tableViewsServerTool.execute(
      { operation: 'create_view', args: { tableId: 'tbl-1', name: 'Mine', isDefault: true } },
      context
    )

    expect(executeUseCase).toHaveBeenCalledTimes(2)
    expect(executeUseCase.mock.calls[1][2]).toMatchObject({ isDefault: true })
    expect(result.message).toContain('as default')
    expect(result.data.view.isDefault).toBe(true)
  })

  it('names the table and view on update, and only the table on delete', async () => {
    const stored = { id: 'view-1', name: 'Overdue', isDefault: false, config: {} }
    executeUseCase.mockResolvedValueOnce({ table, views: [stored] }).mockResolvedValueOnce({
      view: { ...stored, name: 'Late' },
      table,
    })
    const updated = await tableViewsServerTool.execute(
      { operation: 'update_view', args: { tableId: 'tbl-1', viewId: 'view-1', name: 'Late' } },
      context
    )
    expect(updated.data).toMatchObject({
      tableId: 'tbl-1',
      tableName: 'Invoices',
      viewId: 'view-1',
    })

    executeUseCase.mockResolvedValueOnce({ viewId: 'view-1', viewName: 'Late', table })
    const deleted = await tableViewsServerTool.execute(
      { operation: 'delete_view', args: { tableId: 'tbl-1', viewId: 'view-1' } },
      context
    )
    expect(deleted.data).toEqual({ tableId: 'tbl-1', tableName: 'Invoices' })
  })

  it('rejects unknown column names with the columns spelled out', async () => {
    executeUseCase.mockResolvedValueOnce({ table, views: [] })

    const failure = await tableViewsServerTool
      .execute(
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
      .catch((error: unknown) => error)

    // Classified as the caller's mistake, so the model sees the column name
    // instead of a masked system error.
    expect(asOrchestrationError(failure)?.code).toBe('validation')
    expect(asOrchestrationError(failure)?.message).toMatch(/Unknown column/)
    expect(executeUseCase).toHaveBeenCalledTimes(1)
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
