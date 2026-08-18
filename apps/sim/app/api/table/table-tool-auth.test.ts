/**
 * @vitest-environment node
 *
 * The executor reaches the internal table row routes through the Table block's
 * tools, and those routes now authenticate with the delegation policy rather
 * than the legacy internal token. Two things have to line up for that to work,
 * and neither is visible to a route test that mocks the auth policy:
 *
 *  1. the tool must ask the executor to mint a delegation token, and
 *  2. the operation's policy must admit the `executor` delegated service.
 *
 * Both are pinned here because getting either wrong fails every workflow call
 * to these endpoints — the first as a 401, the second as a 403 — while every
 * route-level test keeps passing.
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
  it.each(EXECUTOR_ROW_TOOLS)('%s asks the executor for a delegation token', (_name, tool) => {
    // Without this the executor mints a legacy internal token, which the
    // delegation policy rejects outright.
    expect(tool.request.internalAuth).toBe('executor_delegation')
  })

  it.each(EXECUTOR_ROW_TOOLS)(
    '%s runs under an operation that admits the executor',
    (_name, _tool, operation) => {
      expect(operation.delegatedServices).toContain('executor')
      expect(operation.principalKinds).toContain('delegated')
    }
  )
})
