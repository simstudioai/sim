/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectTableBlockColumnReferences,
  findUnmigratedTableBlockReferences,
  isTableBlockBoundTo,
} from '@/lib/table/columns/workflow-references'

function subBlocks(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
  )
}

/**
 * A rename migrates everything keyed by column id; a Table block's authored
 * `filter`/`order`/`data` name columns by name and live in workflow state the
 * rename never touches. These are what the rename response must point at.
 */
describe('collectTableBlockColumnReferences', () => {
  it('finds the old name in a bare filter condition, a sort spec, and a row payload', () => {
    const fields = collectTableBlockColumnReferences(
      subBlocks({
        filter: '{"field":"wins","op":"gte","value":10}',
        order: '[{"field":"wins","direction":"desc"}]',
        data: '{"wins": 3, "name": "<start.name>"}',
      }),
      'wins'
    )

    expect(fields).toEqual(['filter', 'order', 'data'])
  })

  it('walks nested all/any groups and a record-shaped sort, matching case-insensitively', () => {
    const fields = collectTableBlockColumnReferences(
      subBlocks({
        filter:
          '{"any":[{"field":"status","op":"eq","value":"open"},{"all":[{"field":"Wins","op":"gt","value":1}]}]}',
        order: '{"WINS":"asc"}',
      }),
      'wins'
    )

    expect(fields).toEqual(['filter', 'order'])
  })

  it('does not report a column that only appears as a value', () => {
    expect(
      collectTableBlockColumnReferences(
        subBlocks({ filter: '{"field":"status","op":"eq","value":"wins"}' }),
        'wins'
      )
    ).toEqual([])
  })

  it('falls back to a quoted-token match when the text is not JSON', () => {
    expect(
      collectTableBlockColumnReferences(
        subBlocks({ filter: '{"field":"wins","op":"eq","value":<start.threshold>}' }),
        'wins'
      )
    ).toEqual(['filter'])
    expect(
      collectTableBlockColumnReferences(subBlocks({ filter: '<start.filter>' }), 'wins')
    ).toEqual([])
  })

  it('ignores empty and absent sub-blocks', () => {
    expect(collectTableBlockColumnReferences(subBlocks({ filter: '  ' }), 'wins')).toEqual([])
    expect(collectTableBlockColumnReferences({}, 'wins')).toEqual([])
  })
})

describe('isTableBlockBoundTo', () => {
  it('accepts the manual id, the selector, or a canonical tableId', () => {
    expect(isTableBlockBoundTo(subBlocks({ manualTableId: 'tbl_1' }), 'tbl_1')).toBe(true)
    expect(isTableBlockBoundTo(subBlocks({ tableSelector: 'tbl_1' }), 'tbl_1')).toBe(true)
    expect(isTableBlockBoundTo(subBlocks({ tableId: ' tbl_1 ' }), 'tbl_1')).toBe(true)
    expect(isTableBlockBoundTo(subBlocks({ manualTableId: 'tbl_2' }), 'tbl_1')).toBe(false)
  })
})

describe('findUnmigratedTableBlockReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reports only Table blocks bound to the table that still name the column', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      {
        workflowId: 'wf-2',
        workflowName: 'Weekly digest',
        blockId: 'blk-b',
        blockName: 'Query wins',
        subBlocks: subBlocks({
          manualTableId: 'tbl_1',
          filter: '{"field":"wins","op":"gte","value":10}',
          order: '[{"field":"name","direction":"asc"}]',
        }),
      },
      {
        workflowId: 'wf-1',
        workflowName: 'Alerts',
        blockId: 'blk-a',
        blockName: 'Insert',
        subBlocks: subBlocks({ tableSelector: 'tbl_1', data: '{"wins": 1}' }),
      },
      {
        workflowId: 'wf-1',
        workflowName: 'Alerts',
        blockId: 'blk-other-table',
        blockName: 'Other table',
        subBlocks: subBlocks({ manualTableId: 'tbl_9', data: '{"wins": 1}' }),
      },
      {
        workflowId: 'wf-1',
        workflowName: 'Alerts',
        blockId: 'blk-clean',
        blockName: 'Clean',
        subBlocks: subBlocks({
          manualTableId: 'tbl_1',
          filter: '{"field":"name","op":"eq","value":"x"}',
        }),
      },
    ])

    await expect(
      findUnmigratedTableBlockReferences({
        workspaceId: 'ws-1',
        tableId: 'tbl_1',
        columnName: 'wins',
      })
    ).resolves.toEqual([
      {
        workflowId: 'wf-1',
        workflowName: 'Alerts',
        blockId: 'blk-a',
        blockName: 'Insert',
        fields: ['data'],
      },
      {
        workflowId: 'wf-2',
        workflowName: 'Weekly digest',
        blockId: 'blk-b',
        blockName: 'Query wins',
        fields: ['filter'],
      },
    ])
    expect(dbChainMockFns.innerJoin).toHaveBeenCalledTimes(1)
  })
})
