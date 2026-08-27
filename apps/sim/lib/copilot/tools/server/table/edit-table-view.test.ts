/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const useCases = vi.hoisted(() => ({
  owner: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/table/application/views', () => ({
  resolveTableViewOwnerUseCase: {
    operation: { id: 'tables.views.read' },
    execute: useCases.owner,
  },
  readTableViewUseCase: { operation: { id: 'tables.views.read' }, execute: useCases.read },
  updateTableViewUseCase: { operation: { id: 'tables.views.update' }, execute: useCases.update },
}))

const executeUseCase = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copilot/application/execute-table-use-case', () => ({
  executeCopilotTableUseCase: executeUseCase,
}))

import { editTableViewServerTool } from '@/lib/copilot/tools/server/table/edit-table-view'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  readTableViewUseCase,
  resolveTableViewOwnerUseCase,
  updateTableViewUseCase,
} from '@/lib/table/application/views'

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

/** owner lookup (workspace scope) → read (table scope) → update (table scope) */
function queueHappyPath(updatedView: typeof storedView) {
  executeUseCase
    .mockResolvedValueOnce({ tableId: 'tbl-1' })
    .mockResolvedValueOnce({ table, view: storedView, columns })
    .mockResolvedValueOnce({ table, view: updatedView })
}

describe('edit_table_view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the table from the view id without a scope, then re-enters table-scoped', async () => {
    queueHappyPath({
      ...storedView,
      config: {
        filter: { all: [{ field: 'col_a', op: 'eq', value: 'Open' }] },
        sort: [{ field: 'col_b', direction: 'asc' }],
      },
    })

    const result = await editTableViewServerTool.execute(
      {
        viewId: 'view-1',
        config: { filter: { all: [{ field: 'status', op: 'eq', value: 'Open' }] } },
      },
      context
    )

    // The delegated principal has no table to scope to yet, so the owner
    // lookup must not claim one.
    expect(executeUseCase).toHaveBeenNthCalledWith(1, context, resolveTableViewOwnerUseCase, {
      viewId: 'view-1',
      workspaceId: 'ws-1',
    })
    expect(executeUseCase).toHaveBeenNthCalledWith(
      2,
      context,
      readTableViewUseCase,
      { tableId: 'tbl-1', workspaceId: 'ws-1', viewId: 'view-1' },
      { tableId: 'tbl-1' }
    )
    // No `sort` key at all: the patch is shallow-merged server-side, so a
    // present-but-null sort would wipe the saved one.
    expect(executeUseCase).toHaveBeenNthCalledWith(
      3,
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
    queueHappyPath({ ...storedView, name: 'Late', isDefault: true })

    const result = await editTableViewServerTool.execute(
      { viewId: 'view-1', name: 'Late', isDefault: true, config: {} },
      context
    )

    const updateInput = executeUseCase.mock.calls[2][2]
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

  it("classifies an unknown column as the caller's mistake, before the write", async () => {
    executeUseCase
      .mockResolvedValueOnce({ tableId: 'tbl-1' })
      .mockResolvedValueOnce({ table, view: storedView, columns })

    const failure = await editTableViewServerTool
      .execute({ viewId: 'view-1', config: { hiddenColumns: ['priority'] } }, context)
      .catch((error: unknown) => error)

    expect(asOrchestrationError(failure)?.code).toBe('validation')
    expect(asOrchestrationError(failure)?.message).toMatch(/Unknown column\(s\): priority/)
    expect(executeUseCase).toHaveBeenCalledTimes(2)
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
