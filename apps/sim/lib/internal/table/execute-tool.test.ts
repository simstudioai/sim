/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'
import type { ExecutionContext } from '@/executor/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  getSchema: vi.fn(),
  getRow: vi.fn(),
  insertRows: vi.fn(),
  queryRows: vi.fn(),
  queryRowsV2: vi.fn(),
  updateRow: vi.fn(),
  updateRowsByFilter: vi.fn(),
  deleteRow: vi.fn(),
  deleteRows: vi.fn(),
  upsertRow: vi.fn(),
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  restoreFolder: vi.fn(),
  move: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/internal/table/operations', () => ({
  executeTableCreate: mocks.create,
  executeTableList: mocks.list,
  executeTableGetSchema: mocks.getSchema,
  executeTableGetRow: mocks.getRow,
  executeTableInsertRows: mocks.insertRows,
  executeTableQueryRows: mocks.queryRows,
  executeTableQueryRowsV2: mocks.queryRowsV2,
  executeTableUpdateRow: mocks.updateRow,
  executeTableUpdateRowsByFilter: mocks.updateRowsByFilter,
  executeTableDeleteRow: mocks.deleteRow,
  executeTableDeleteRows: mocks.deleteRows,
  executeTableUpsertRow: mocks.upsertRow,
  executeTableListFolders: mocks.listFolders,
  executeTableCreateFolder: mocks.createFolder,
  executeTableUpdateFolder: mocks.updateFolder,
  executeTableDeleteFolder: mocks.deleteFolder,
  executeTableRestoreFolder: mocks.restoreFolder,
  executeTableMove: mocks.move,
}))

import { executeTableTool } from '@/lib/internal/table/execute-tool'
import { TableRowsValidationError, TableV2FeatureDisabledError } from '@/lib/table/application/rows'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

const CONTEXT = {
  workflowId: 'workflow-1',
  userId: 'user-1',
} as ExecutionContext

const WIRE_ROW = {
  id: 'row-1',
  data: { Email: 'a@example.com' },
  position: 0,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}

interface Case {
  toolId: string
  input: Record<string, unknown>
  operation: keyof typeof mocks
  tableId?: string
}

const CASES: Case[] = [
  {
    toolId: 'table_create',
    input: {
      workspaceId: 'workspace-forged',
      name: 'Contacts',
      schema: { columns: [{ name: 'Email', type: 'string' }] },
    },
    operation: 'create',
  },
  {
    toolId: 'table_list',
    input: { workspaceId: 'workspace-forged' },
    operation: 'list',
  },
  {
    toolId: 'table_get_schema',
    input: { tableId: 'table-1', workspaceId: 'workspace-forged' },
    operation: 'getSchema',
    tableId: 'table-1',
  },
  {
    toolId: 'table_get_row',
    input: { tableId: 'table-1', rowId: 'row-1', workspaceId: 'workspace-forged' },
    operation: 'getRow',
    tableId: 'table-1',
  },
  {
    toolId: 'table_insert_row',
    input: {
      tableId: 'table-1',
      workspaceId: 'workspace-forged',
      data: { Email: 'a@example.com' },
    },
    operation: 'insertRows',
    tableId: 'table-1',
  },
  {
    toolId: 'table_batch_insert_rows',
    input: {
      tableId: 'table-1',
      workspaceId: 'workspace-forged',
      rows: [{ Email: 'a@example.com' }],
    },
    operation: 'insertRows',
    tableId: 'table-1',
  },
  {
    toolId: 'table_query_rows',
    input: { tableId: 'table-1', workspaceId: 'workspace-forged', limit: '10' },
    operation: 'queryRows',
    tableId: 'table-1',
  },
  {
    toolId: 'table_query_rows_v2',
    input: { tableId: 'table-1', workspaceId: 'workspace-forged', limit: 10 },
    operation: 'queryRowsV2',
    tableId: 'table-1',
  },
  {
    toolId: 'table_update_row',
    input: {
      tableId: 'table-1',
      rowId: 'row-1',
      workspaceId: 'workspace-forged',
      data: { Email: 'b@example.com' },
    },
    operation: 'updateRow',
    tableId: 'table-1',
  },
  {
    toolId: 'table_update_rows_by_filter',
    input: {
      tableId: 'table-1',
      workspaceId: 'workspace-forged',
      filter: { Email: { $eq: 'a@example.com' } },
      data: { Email: 'b@example.com' },
    },
    operation: 'updateRowsByFilter',
    tableId: 'table-1',
  },
  {
    toolId: 'table_delete_row',
    input: { tableId: 'table-1', rowId: 'row-1', workspaceId: 'workspace-forged' },
    operation: 'deleteRow',
    tableId: 'table-1',
  },
  {
    toolId: 'table_delete_rows_by_filter',
    input: {
      tableId: 'table-1',
      workspaceId: 'workspace-forged',
      filter: { Email: { $eq: 'a@example.com' } },
    },
    operation: 'deleteRows',
    tableId: 'table-1',
  },
  {
    toolId: 'table_upsert_row',
    input: {
      tableId: 'table-1',
      workspaceId: 'workspace-forged',
      data: { Email: 'a@example.com' },
    },
    operation: 'upsertRow',
    tableId: 'table-1',
  },
  {
    toolId: 'table_list_folders',
    input: { path: '/Reports', recursive: true, depth: 2 },
    operation: 'listFolders',
  },
  {
    toolId: 'table_create_folder',
    input: { path: '/Reports/Q3' },
    operation: 'createFolder',
  },
  {
    toolId: 'table_update_folder',
    input: { path: '/Reports/Q3', destinationPath: '/Archive/Q3' },
    operation: 'updateFolder',
  },
  {
    toolId: 'table_delete_folder',
    input: { path: '/Reports', recursive: false },
    operation: 'deleteFolder',
  },
  {
    toolId: 'table_restore_folder',
    input: { path: '/Reports/Q3' },
    operation: 'restoreFolder',
  },
  {
    toolId: 'table_move',
    input: { tableId: 'table-1', folderPath: '/Reports' },
    operation: 'move',
    tableId: 'table-1',
  },
]

const WIRE_FOLDER = {
  name: 'Q3',
  path: '/Reports/Q3',
  parentPath: '/Reports',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}

describe('executeTableTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.create.mockResolvedValue({
      body: { success: true, data: { table: {}, message: 'Table created successfully' } },
    })
    mocks.list.mockResolvedValue({
      body: { success: true, data: { tables: [], totalCount: 0 } },
    })
    mocks.getSchema.mockResolvedValue({
      body: { success: true, data: { table: {} } },
    })
    mocks.getRow.mockResolvedValue({
      body: { success: true, data: { row: WIRE_ROW } },
    })
    mocks.insertRows.mockImplementation(async (_tableId, body) => ({
      body:
        'rows' in body
          ? {
              success: true,
              data: { rows: [WIRE_ROW], insertedCount: 1, message: 'Rows inserted successfully' },
            }
          : {
              success: true,
              data: { row: WIRE_ROW, message: 'Row inserted successfully' },
            },
    }))
    mocks.queryRows.mockResolvedValue({
      body: {
        success: true,
        data: {
          rows: [WIRE_ROW],
          rowCount: 1,
          totalCount: 1,
          limit: 10,
          offset: 0,
          nextCursor: null,
        },
      },
    })
    mocks.queryRowsV2.mockResolvedValue({
      body: {
        success: true,
        data: { rows: [WIRE_ROW], rowCount: 1, totalCount: 1, limit: 10, nextCursor: null },
      },
    })
    mocks.updateRow.mockResolvedValue({
      body: { success: true, data: { row: WIRE_ROW, message: 'Row updated successfully' } },
    })
    mocks.updateRowsByFilter.mockResolvedValue({
      body: {
        success: true,
        data: { message: 'Rows updated successfully', updatedCount: 1, updatedRowIds: ['row-1'] },
      },
    })
    mocks.deleteRow.mockResolvedValue({
      body: { success: true, data: { message: 'Row deleted successfully', deletedCount: 1 } },
    })
    mocks.deleteRows.mockResolvedValue({
      body: {
        success: true,
        data: { message: 'Rows deleted successfully', deletedCount: 1, deletedRowIds: ['row-1'] },
      },
    })
    mocks.upsertRow.mockResolvedValue({
      body: {
        success: true,
        data: {
          row: WIRE_ROW,
          operation: 'insert',
          message: 'Row inserted successfully',
        },
      },
    })
    mocks.listFolders.mockResolvedValue({
      body: {
        success: true,
        data: { path: '/Reports', folders: [{ ...WIRE_FOLDER, depth: 1 }], truncated: false },
      },
    })
    mocks.createFolder.mockResolvedValue({
      body: { success: true, data: { folder: WIRE_FOLDER } },
    })
    mocks.updateFolder.mockResolvedValue({
      body: { success: true, data: { folder: WIRE_FOLDER, previousPath: '/Reports/Q3' } },
    })
    mocks.deleteFolder.mockResolvedValue({
      body: {
        success: true,
        data: { path: '/Reports', deleted: true, deletedItems: { folders: 1, tables: 2 } },
      },
    })
    mocks.restoreFolder.mockResolvedValue({
      body: {
        success: true,
        data: {
          folder: WIRE_FOLDER,
          requestedPath: '/Reports/Q3',
          restoredItems: { folders: 1, tables: 2 },
        },
      },
    })
    mocks.move.mockResolvedValue({
      body: {
        success: true,
        data: { tableId: 'table-1', name: 'Contacts', folderPath: '/Reports' },
      },
    })
  })

  it.each(CASES)('dispatches $toolId through its canonical operation input', async (testCase) => {
    const response = await executeTableTool({
      toolId: testCase.toolId,
      input: testCase.input,
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(mocks[testCase.operation]).toHaveBeenCalledOnce()
    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: CONTEXT,
      audience: 'sim:tables',
      ...(testCase.tableId ? { resourceScope: { tableId: testCase.tableId } } : {}),
    })
  })

  it('authenticates before contract parsing and rejects missing trusted identity', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new Error('Authentication required'))

    const response = await executeTableTool({
      toolId: 'table_create',
      input: null,
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('projects a stale workflow binding as authentication failure', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new InvalidInternalDelegationBindingError())

    const response = await executeTableTool({
      toolId: 'table_list',
      input: { workspaceId: 'workspace-forged' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
  })

  it('rejects malformed operation input', async () => {
    const response = await executeTableTool({
      toolId: 'table_get_row',
      input: { tableId: 'table-1', workspaceId: 'workspace-forged' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(mocks.getRow).not.toHaveBeenCalled()
  })

  it('validates operation output against the canonical response contract', async () => {
    mocks.getRow.mockResolvedValueOnce({ body: { success: true, data: { row: {} } } })

    const response = await executeTableTool({
      toolId: 'table_get_row',
      input: { tableId: 'table-1', rowId: 'row-1', workspaceId: 'workspace-forged' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to get row' })
  })

  it('preserves the v2 rollout-gate error contract', async () => {
    mocks.queryRowsV2.mockRejectedValueOnce(new TableV2FeatureDisabledError())

    const response = await executeTableTool({
      toolId: 'table_query_rows_v2',
      input: { tableId: 'table-1', workspaceId: 'workspace-forged', limit: 10 },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'The v2 table query API is not enabled for this workspace',
      code: 'tables_v2_disabled',
    })
  })

  it('preserves v2 query validation codes', async () => {
    mocks.queryRowsV2.mockRejectedValueOnce(
      new TableRowsValidationError('Unknown sort column "Missing"', {
        code: 'INVALID_ORDER',
      })
    )

    const response = await executeTableTool({
      toolId: 'table_query_rows_v2',
      input: { tableId: 'table-1', workspaceId: 'workspace-forged', limit: 10 },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Unknown sort column "Missing"',
      code: 'INVALID_ORDER',
    })
  })

  it('parses a folder tool against its standalone schemas', async () => {
    const response = await executeTableTool({
      toolId: 'table_create_folder',
      input: { path: 'Reports/Q3' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    /* A missing leading slash is normalized before validation, not rejected. */
    expect(response.status).toBe(200)
    expect(mocks.createFolder).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/Reports/Q3' }),
      expect.anything()
    )
  })

  it('rejects a folder path that is not canonical', async () => {
    const response = await executeTableTool({
      toolId: 'table_delete_folder',
      input: { path: '/Reports/' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(mocks.deleteFolder).not.toHaveBeenCalled()
  })

  it('refuses to mutate the workspace root', async () => {
    const response = await executeTableTool({
      toolId: 'table_delete_folder',
      input: { path: '/' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(mocks.deleteFolder).not.toHaveBeenCalled()
  })

  it('validates a folder result against its response schema', async () => {
    mocks.listFolders.mockResolvedValue({
      body: { success: true, data: { path: '/Reports', folders: [{ name: 'Q3' }] } },
    })

    const response = await executeTableTool({
      toolId: 'table_list_folders',
      input: { path: '/Reports' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(500)
  })

  it('leaves a folder tool unscoped, because it addresses no table', async () => {
    await executeTableTool({
      toolId: 'table_list_folders',
      input: { path: '/Reports' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: CONTEXT,
      audience: 'sim:tables',
    })
  })

  it('scopes a move to its table without demanding a caller-asserted workspace', async () => {
    /*
     * `table_move` sends no workspaceId — the workspace is the principal's — so
     * scoping it through `getTableContract`, whose query requires one, rejected
     * every move as malformed before it reached the operation.
     */
    const response = await executeTableTool({
      toolId: 'table_move',
      input: { tableId: 'table-1', folderPath: '/Reports' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: CONTEXT,
      audience: 'sim:tables',
      resourceScope: { tableId: 'table-1' },
    })
  })

  it('rejects a move that names no table before minting a delegation', async () => {
    const response = await executeTableTool({
      toolId: 'table_move',
      input: { folderPath: '/Reports' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
  })
})
