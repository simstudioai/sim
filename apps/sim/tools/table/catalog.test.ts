/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { projectBlockDetail } from '@/lib/catalog/projection/block-detail'
import { TableBlock } from '@/blocks/blocks/table'
import { TableV2Block } from '@/blocks/blocks/table_v2'
import { tableQueryRowsV2Tool } from '@/tools/table/query_rows_v2'

/** Org discovery spans workspaces; a saved workflow still executes in one. */
describe('Table workspace binding in authoring metadata', () => {
  it.each([TableBlock, TableV2Block])(
    '$type exposes the binding in its generated operation contract',
    (block) => {
      const detail = projectBlockDetail(block, { deployment: { hostedKeys: false } })
      expect(detail.inputDefinitions.tableId.description).toContain(
        'same workspace as the workflow'
      )
      for (const operation of Object.values(detail.operations)) {
        if (operation.inputs.tableId) {
          expect(operation.inputs.tableId.description).toContain('same workspace as the workflow')
        }
      }
      for (const tool of detail.tools) {
        if (tool.params.tableId) {
          expect(tool.params.tableId.description).toContain('same workspace as the workflow')
        }
      }
    }
  )

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
