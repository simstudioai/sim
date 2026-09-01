/**
 * @vitest-environment node
 *
 * Table block tools execute through the in-process operation boundary. Two
 * things have to line up for that to work:
 *
 *  1. the tool must declare an in-process operation, and
 *  2. the operation's policy must admit a runtime workflow principal.
 */
import { describe, expect, it } from 'vitest'
import { tableOperations } from '@/lib/table/application/operations'
import { tableDeleteRowTool } from '@/tools/table/delete_row'
import { tableGetRowTool } from '@/tools/table/get_row'
import { tableUpdateRowTool } from '@/tools/table/update_row'
import { tableUpsertRowTool } from '@/tools/table/upsert_row'

/** Tool → the operation its route runs under. */
const EXECUTOR_ROW_TOOLS = [
  ['table_get_row', tableGetRowTool, tableOperations.readRow],
  ['table_update_row', tableUpdateRowTool, tableOperations.updateRow],
  ['table_delete_row', tableDeleteRowTool, tableOperations.deleteRow],
  ['table_upsert_row', tableUpsertRowTool, tableOperations.upsertRow],
] as const

describe('executor access to the migrated table row routes', () => {
  it.each(EXECUTOR_ROW_TOOLS)('%s declares an in-process operation', (_name, tool) => {
    expect(tool.request).toBeUndefined()
    expect(tool.operation.input).toBeTypeOf('function')
  })

  it.each(EXECUTOR_ROW_TOOLS)(
    '%s runs under an operation that admits workflow execution',
    (_name, _tool, operation) => {
      expect(operation.workflowExecution).toBe('allow')
    }
  )
})
