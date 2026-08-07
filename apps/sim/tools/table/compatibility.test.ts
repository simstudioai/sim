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

    expect(tableInsertRowTool.request.modelInput).toBeUndefined()
    expect(tableBatchInsertRowsTool.request.modelInput).toBeUndefined()
    expect(tableUpsertRowTool.request.modelInput).toBeUndefined()
    expect(tableUpdateRowTool.request.modelInput).toBeUndefined()
    expect(tableUpdateRowsByFilterTool.request.modelInput).toBeUndefined()

    expect(
      tableInsertRowTool.request.body?.({
        tableId: 'table-1',
        data,
        _context: { workspaceId: 'workspace-1' },
      })
    ).toEqual({ data, workspaceId: 'workspace-1' })
    expect(
      tableBatchInsertRowsTool.request.body?.({
        tableId: 'table-1',
        rows,
        _context: { workspaceId: 'workspace-1' },
      })
    ).toEqual({ rows, workspaceId: 'workspace-1' })
  })
})
