import { describe, expect, it } from 'vitest'
import { tableQueryRowsV2Tool } from '@/tools/table/query_rows_v2'

/** Org discovery spans workspaces; a saved workflow still executes in one. */
describe('Table workspace binding in authoring metadata', () => {
  it('binds the query to trusted execution scope even if input carries another workspace', () => {
    const input = {
      tableId: 'foreign-table',
      workspaceId: 'caller-selected-other-workspace',
      _context: { workspaceId: 'workflow-workspace' },
    }
    expect(tableQueryRowsV2Tool.operation.input(input)).toEqual({
      tableId: 'foreign-table',
      workspaceId: 'workflow-workspace',
    })
  })
})
