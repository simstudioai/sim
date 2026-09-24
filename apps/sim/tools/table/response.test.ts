/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { tableBatchInsertRowsTool } from '@/tools/table/batch_insert_rows'
import { tableCreateTool } from '@/tools/table/create'
import { tableDeleteRowTool } from '@/tools/table/delete_row'
import { tableDeleteRowsByFilterTool } from '@/tools/table/delete_rows_by_filter'
import { tableGetRowTool } from '@/tools/table/get_row'
import { tableGetSchemaTool } from '@/tools/table/get_schema'
import { tableInsertRowTool } from '@/tools/table/insert_row'
import { tableListTool } from '@/tools/table/list'
import { tableQueryRowsTool } from '@/tools/table/query_rows'
import { tableQueryRowsV2Tool } from '@/tools/table/query_rows_v2'
import { tableUpdateRowTool } from '@/tools/table/update_row'
import { tableUpdateRowsByFilterTool } from '@/tools/table/update_rows_by_filter'
import { tableUpsertRowTool } from '@/tools/table/upsert_row'

const row = { id: 'row-1', data: { quantity: 17 }, executions: {} }
const table = {
  id: 'table-1',
  name: 'Inventory',
  schema: { columns: [{ name: 'quantity', type: 'number' }] },
  rowCount: 1,
  maxRows: 100,
}
const data = {
  table,
  tables: [table],
  row,
  rows: [row],
  operation: 'insert',
  rowCount: 1,
  totalCount: 1,
  insertedCount: 1,
  updatedCount: 1,
  deletedCount: 1,
  updatedRowIds: [row.id],
  deletedRowIds: [row.id],
  limit: 10,
  offset: 0,
  nextCursor: null,
  message: 'Done',
}

/** The executor discards the envelope; its success alone does not satisfy workflow references. */
describe('Table declared workflow outputs', () => {
  it.each([
    tableBatchInsertRowsTool,
    tableCreateTool,
    tableDeleteRowTool,
    tableDeleteRowsByFilterTool,
    tableGetRowTool,
    tableGetSchemaTool,
    tableInsertRowTool,
    tableListTool,
    tableQueryRowsTool,
    tableQueryRowsV2Tool,
    tableUpdateRowTool,
    tableUpdateRowsByFilterTool,
    tableUpsertRowTool,
  ])('$id makes its advertised success available alongside its operation payload', async (tool) => {
    expect(tool.outputs?.success.type).toBe('boolean')
    const response = await tool.transformResponse!(Response.json({ success: true, data }))
    expect(response.success).toBe(true)
    expect(response.output).toHaveProperty('success', true)
    for (const key of Object.keys(tool.outputs ?? {})) {
      expect(response.output, `${tool.id}.${key}`).toHaveProperty(key)
    }
    for (const key of ['row', 'rows', 'table', 'tables'] as const) {
      if (key in response.output) expect(response.output[key]).toEqual(data[key])
    }
  })
})
