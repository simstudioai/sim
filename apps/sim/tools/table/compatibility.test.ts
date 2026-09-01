/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tableBatchInsertRowsTool } from '@/tools/table/batch_insert_rows'
import { tableInsertRowTool } from '@/tools/table/insert_row'
import { tableUpdateRowTool } from '@/tools/table/update_row'
import { tableUpdateRowsByFilterTool } from '@/tools/table/update_rows_by_filter'
import { tableUpsertRowTool } from '@/tools/table/upsert_row'

describe('table write compatibility', () => {
  it('does not rewrite typed values before table validation and coercion', () => {
    const data = {
      numberValue: '123',
      booleanValue: 'true',
      dateValue: '2026-08-04',
      stringValue: 'Bearer resolved-secret',
    }
    const rows = [data]

    expect(tableInsertRowTool.operation.modelInput).toBeUndefined()
    expect(tableBatchInsertRowsTool.operation.modelInput).toBeUndefined()
    expect(tableUpsertRowTool.operation.modelInput).toBeUndefined()
    expect(tableUpdateRowTool.operation.modelInput).toBeUndefined()
    expect(tableUpdateRowsByFilterTool.operation.modelInput).toBeUndefined()

    expect(
      tableInsertRowTool.operation.input({
        tableId: 'table-1',
        data,
        _context: { workspaceId: 'workspace-1' },
      })
    ).toEqual({ tableId: 'table-1', data, workspaceId: 'workspace-1' })
    expect(
      tableBatchInsertRowsTool.operation.input({
        tableId: 'table-1',
        rows,
        _context: { workspaceId: 'workspace-1' },
      })
    ).toEqual({ tableId: 'table-1', rows, workspaceId: 'workspace-1' })
  })
})
