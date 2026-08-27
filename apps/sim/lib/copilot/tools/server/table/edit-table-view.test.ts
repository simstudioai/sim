/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const useCases = vi.hoisted(() => ({
  readById: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/table/application/views', () => ({
  readTableViewByIdUseCase: { operation: { id: 'tables.views.read' }, execute: useCases.readById },
  updateTableViewUseCase: { operation: { id: 'tables.views.update' }, execute: useCases.update },
}))

const executeUseCase = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copilot/application/execute-table-use-case', () => ({
  executeCopilotTableUseCase: executeUseCase,
}))

import { editTableViewServerTool } from '@/lib/copilot/tools/server/table/edit-table-view'
import { readTableViewByIdUseCase, updateTableViewUseCase } from '@/lib/table/application/views'

const context = { userId: 'user-1', workspaceId: 'ws-1', copilotToolExecution: true } as never

const columns = [
  { id: 'col_a', name: 'status', type: 'string' },
  { id: 'col_b', name: 'due', type: 'date' },
]
const table = { id: 'tbl-1', name: 'Invoices', schema: { columns } }
const storedView = {
  id: 'view-1',
  name: 'Overdue',
  isDefault: false,
  config: { sort: [{ field: 'col_b', direction: 'asc' }] },
}

describe('edit_table_view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the table from the view id, then patches only the parts sent', async () => {
    executeUseCase
      .mockResolvedValueOnce({ table, view: storedView, columns })
      .mockResolvedValueOnce({
        table,
        view: {
          ...storedView,
          config: {
            filter: { all: [{ field: 'col_a', op: 'eq', value: 'Open' }] },
            sort: [{ field: 'col_b', direction: 'asc' }],
          },
        },
      })

    const result = await editTableViewServerTool.execute(
      {
        viewId: 'view-1',
        config: { filter: { all: [{ field: 'status', op: 'eq', value: 'Open' }] } },
      },
      context
    )

    expect(executeUseCase).toHaveBeenNthCalledWith(1, context, readTableViewByIdUseCase, {
      viewId: 'view-1',
      workspaceId: 'ws-1',
    })
    // No `sort` key at all: the patch is shallow-merged server-side, so a
    // present-but-null sort would wipe the saved one.
    expect(executeUseCase).toHaveBeenNthCalledWith(
      2,
      context,
      updateTableViewUseCase,
      {
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        viewId: 'view-1',
        name: undefined,
        configPatch: { filter: { all: [{ field: 'col_a', op: 'eq', value: 'Open' }] } },
        isDefault: undefined,
      },
      { tableId: 'tbl-1' }
    )
    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      viewId: 'view-1',
      tableId: 'tbl-1',
      tableName: 'Invoices',
      view: {
        id: 'view-1',
        name: 'Overdue',
        isDefault: false,
        filter: { all: [{ field: 'status', op: 'eq', value: 'Open' }] },
        sort: [{ field: 'due', direction: 'asc' }],
        hiddenColumns: undefined,
      },
    })
  })

  it('renames or promotes without touching the config', async () => {
    executeUseCase
      .mockResolvedValueOnce({ table, view: storedView, columns })
      .mockResolvedValueOnce({ table, view: { ...storedView, name: 'Late', isDefault: true } })

    const result = await editTableViewServerTool.execute(
      { viewId: 'view-1', name: 'Late', isDefault: true, config: {} },
      context
    )

    const updateInput = executeUseCase.mock.calls[1][2]
    expect(updateInput).toEqual({
      tableId: 'tbl-1',
      workspaceId: 'ws-1',
      viewId: 'view-1',
      name: 'Late',
      isDefault: true,
    })
    expect(updateInput).not.toHaveProperty('configPatch')
    expect(result.message).toBe('Updated view "Late" on table "Invoices"')
  })

  it('refuses a call that names nothing to change, before any lookup', async () => {
    const result = await editTableViewServerTool.execute({ viewId: 'view-1', config: {} }, context)

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Nothing to change/)
    expect(executeUseCase).not.toHaveBeenCalled()
  })

  it('refuses without a view id and without workspace context', async () => {
    expect(await editTableViewServerTool.execute({ viewId: '', name: 'x' }, context)).toEqual({
      success: false,
      message: 'viewId is required',
    })
    expect(
      await editTableViewServerTool.execute({ viewId: 'view-1', name: 'x' }, {
        userId: 'user-1',
      } as never)
    ).toEqual({ success: false, message: 'Workspace ID is required' })
    expect(executeUseCase).not.toHaveBeenCalled()
  })
})
